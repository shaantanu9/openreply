fn main() {
    // Regenerate the capability ACL whenever capabilities or the tauri config
    // change. Without these, editing capabilities/*.json does NOT trigger a
    // rebuild, so the compiled binary keeps a STALE permission set — which is
    // exactly how a dev build ends up throwing "dialog.confirm not allowed"
    // even though capabilities/default.json already grants dialog:allow-confirm.
    println!("cargo:rerun-if-changed=capabilities");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    tauri_build::build()
}
