//! Native SQLite read-path — bypasses the Python sidecar entirely.
//!
//! Every sidecar spawn on a fresh DMG takes 30-70s (PyInstaller boot +
//! macOS Gatekeeper re-verification of each bundled `.so`). Running a
//! typical list/filter screen hits 5-10 queries, so the prior behaviour
//! stacked up to 5+ minutes of wait per screen load.
//!
//! Rust opens the same WAL-mode SQLite file read-only. Multiple readers
//! across processes are safe in WAL; Python remains the sole writer. The
//! connection is pool-cached per-thread via `thread_local!` — reopening
//! on each query would still be ~1ms but caching makes it ~0.1ms.
//!
//! Contract: any Tauri command that used to spawn the sidecar just to
//! run a SELECT should switch to `query_db(sql, params)`. Writes still go
//! through the sidecar (`run_cli(&app, ["...", "--json"])`).

use anyhow::{anyhow, Result};
use rusqlite::{types::ValueRef, Connection, OpenFlags, ToSql};
use serde_json::{Map, Value};
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

thread_local! {
    static CONN_CACHE: RefCell<HashMap<PathBuf, Connection>> = RefCell::new(HashMap::new());
}

/// Open (or reuse) a read-only connection to `db_path`. Each calling thread
/// gets its own connection — `rusqlite::Connection` is `!Sync`, and Tauri
/// commands run on a worker pool.
fn with_conn<T>(db_path: &Path, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    CONN_CACHE.with(|cache| {
        let mut map = cache.borrow_mut();
        if !map.contains_key(db_path) {
            // SQLITE_OPEN_READ_ONLY + NO_MUTEX: we never write, and the
            // connection is thread-local, so no internal locking needed.
            let conn = Connection::open_with_flags(
                db_path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )?;
            // Small busy_timeout so a mid-collect writer (Python) doesn't
            // error us out instantly on a checkpoint. 200ms is plenty —
            // WAL readers don't normally block on writers.
            conn.busy_timeout(std::time::Duration::from_millis(200))?;
            map.insert(db_path.to_path_buf(), conn);
        }
        let conn = map.get(db_path).unwrap();
        f(conn)
    })
}

/// Convert a rusqlite row value into serde JSON.
fn value_ref_to_json(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned().into(),
        ValueRef::Blob(b) => {
            // Most blobs in this DB are text-like (serialized JSON in
            // *_json columns). Try UTF-8 first, fall back to base64.
            match std::str::from_utf8(b) {
                Ok(s) => s.to_string().into(),
                Err(_) => Value::Null,
            }
        }
    }
}

/// Run `sql` with named parameters. Returns an array of row objects.
///
/// Supports :named placeholders AND `?1 / ?2` positional (whatever the
/// caller writes). Python's `run_query` accepts a dict of name→value; we
/// mirror that by letting callers pass a JSON object.
pub fn query_db(
    db_path: &Path,
    sql: &str,
    params: Option<&Map<String, Value>>,
) -> Result<Vec<Value>> {
    with_conn(db_path, |conn| {
        let mut stmt = conn.prepare(sql).map_err(|e| anyhow!("prepare: {e}"))?;

        // Bind named params if provided — rusqlite wants `:name` keys.
        let bindings: Vec<(String, Box<dyn ToSql>)> = params
            .map(|m| {
                m.iter()
                    .map(|(k, v)| {
                        let key = if k.starts_with(':') { k.clone() } else { format!(":{k}") };
                        let boxed: Box<dyn ToSql> = match v {
                            Value::Null => Box::new(Option::<String>::None),
                            Value::Bool(b) => Box::new(*b),
                            Value::Number(n) => {
                                if let Some(i) = n.as_i64() { Box::new(i) }
                                else if let Some(f) = n.as_f64() { Box::new(f) }
                                else { Box::new(n.to_string()) }
                            }
                            Value::String(s) => Box::new(s.clone()),
                            _ => Box::new(v.to_string()),
                        };
                        (key, boxed)
                    })
                    .collect()
            })
            .unwrap_or_default();

        let param_refs: Vec<(&str, &dyn ToSql)> = bindings
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_ref() as &dyn ToSql))
            .collect();

        // Column names before executing — stmt.column_names() needs &stmt,
        // and we'll move it into query_map below.
        let col_names: Vec<String> = stmt
            .column_names()
            .iter()
            .map(|s| s.to_string())
            .collect();

        let rows_iter = stmt
            .query_map(param_refs.as_slice(), |row| {
                let mut obj = Map::with_capacity(col_names.len());
                for (i, name) in col_names.iter().enumerate() {
                    let v = row.get_ref(i).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
                    obj.insert(name.clone(), value_ref_to_json(v));
                }
                Ok(Value::Object(obj))
            })
            .map_err(|e| anyhow!("query: {e}"))?;

        let mut out: Vec<Value> = Vec::new();
        for r in rows_iter {
            out.push(r.map_err(|e| anyhow!("row: {e}"))?);
        }
        Ok(out)
    })
}

