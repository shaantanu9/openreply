fn main() {
    println!("cargo:rerun-if-env-changed=JWT_DESKTOP_SECRET");
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let secret = match std::env::var("JWT_DESKTOP_SECRET") {
        Ok(s) => s,
        Err(_) if profile == "debug" => {
            let fallback = "dev-local-jwt-secret-change-before-release-0123456789".to_string();
            println!(
                "cargo:warning=JWT_DESKTOP_SECRET missing; using debug fallback secret. Set JWT_DESKTOP_SECRET explicitly for production builds."
            );
            fallback
        }
        Err(_) => panic!("JWT_DESKTOP_SECRET must be set at build time"),
    };
    assert!(
        secret.len() >= 32,
        "JWT_DESKTOP_SECRET must be at least 32 chars"
    );
    println!("cargo:rustc-env=JWT_DESKTOP_SECRET={}", secret);
    tauri_build::build()
}
