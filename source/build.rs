use std::{fs, path::Path};
fn main() {
    let root = Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("ui/app");
    let mut output = String::from("static ASSETS: &[(&str,&[u8])] = &[\n");
    fn collect(dir: &Path, root: &Path, out: &mut String) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                collect(&path, root, out)
            } else {
                let url = format!(
                    "/{}",
                    path.strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/")
                );
                out.push_str(&format!(
                    "({:?},include_bytes!({:?})),\n",
                    url,
                    path.to_str().unwrap()
                ));
            }
        }
    }
    collect(&root, &root, &mut output);
    output.push_str("];\n");
    fs::write(
        Path::new(&std::env::var("OUT_DIR").unwrap()).join("assets.rs"),
        output,
    )
    .unwrap();
    println!("cargo:rerun-if-changed=ui/app");
}
