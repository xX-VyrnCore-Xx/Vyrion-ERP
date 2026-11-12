fn main() {
    // The statically linked OpenSSL (SQLCipher) ships objects that point to a debug-symbol
    // file (ossl_static.pdb) that is not distributed. The linker then prints LNK4099 for each
    // of the several hundred objects; the build is correct, only symbols for OpenSSL itself are
    // missing. Ignoring that one warning keeps real linker problems visible.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg=/IGNORE:4099");
    }
    tauri_build::build()
}
