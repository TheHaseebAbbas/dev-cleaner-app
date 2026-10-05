//! Monorepo and workspace boundaries.
//!
//! A folder is a workspace root when it declares members: npm/yarn/bun `workspaces` in
//! package.json, pnpm-workspace.yaml, lerna.json, a Cargo `[workspace]`, Gradle `include`s,
//! go.work, a Dart pub workspace or melos.yaml. A package belongs to the nearest workspace whose
//! member patterns match it, so `apps/web/node_modules` in a pnpm monorepo belongs to the
//! monorepo, not to a separate project called `web`.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    /// Absolute path of the workspace root.
    pub root: String,
    /// "npm", "pnpm", "yarn", "lerna", "cargo", "gradle", "go", "dart" or "melos".
    pub kind: String,
    /// The member this package is, relative to the root ("" for the root itself).
    pub member: String,
}

/// Member patterns declared in `dir`, with the kind of workspace.
pub fn declared(dir: &Path) -> Option<(String, Vec<String>)> {
    let read = |n: &str| std::fs::read_to_string(dir.join(n)).ok();
    if let Some(t) = read("pnpm-workspace.yaml") {
        let m = yaml_list(&t, "packages");
        if !m.is_empty() {
            return Some(("pnpm".into(), m));
        }
    }
    if let Some(t) = read("package.json") {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
            let ws = v.get("workspaces");
            let list = ws.and_then(|w| w.as_array()).or_else(|| ws.and_then(|w| w.get("packages")).and_then(|p| p.as_array()));
            if let Some(list) = list {
                let m: Vec<String> = list.iter().filter_map(|x| x.as_str().map(String::from)).collect();
                if !m.is_empty() {
                    let kind = if dir.join("yarn.lock").exists() { "yarn" } else { "npm" };
                    return Some((kind.into(), m));
                }
            }
        }
    }
    if let Some(t) = read("lerna.json") {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
            let m: Vec<String> = v.get("packages").and_then(|p| p.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_else(|| vec!["packages/*".into()]);
            return Some(("lerna".into(), m));
        }
    }
    if let Some(t) = read("Cargo.toml") {
        if let Some(m) = cargo_members(&t) {
            return Some(("cargo".into(), m));
        }
    }
    for f in ["settings.gradle", "settings.gradle.kts"] {
        if let Some(t) = read(f) {
            let m = gradle_includes(&t);
            if !m.is_empty() {
                return Some(("gradle".into(), m));
            }
        }
    }
    if let Some(t) = read("go.work") {
        let m = go_uses(&t);
        if !m.is_empty() {
            return Some(("go".into(), m));
        }
    }
    if let Some(t) = read("pubspec.yaml") {
        let m = yaml_list(&t, "workspace");
        if !m.is_empty() {
            return Some(("dart".into(), m));
        }
    }
    if let Some(t) = read("melos.yaml") {
        let m = yaml_list(&t, "packages");
        if !m.is_empty() {
            return Some(("melos".into(), m));
        }
    }
    None
}

/// The nearest workspace (at or above `package`, not above `limit`) that has `package` as a
/// member or as its root.
pub fn find(package: &Path, limit: &Path) -> Option<WorkspaceInfo> {
    let mut d = Some(package);
    while let Some(x) = d {
        if !crate::safety::is_within(x, limit) {
            break;
        }
        if let Some((kind, members)) = declared(x) {
            let rel = package.strip_prefix(x).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
            if rel.is_empty() || members.iter().any(|m| glob_match(m, &rel)) {
                return Some(WorkspaceInfo { root: x.to_string_lossy().into_owned(), kind, member: rel });
            }
        }
        d = x.parent();
    }
    None
}

/// Matches a relative path against a workspace member pattern. `*` matches inside one folder
/// name, `**` matches any number of folders. Leading `./` and trailing `/` are ignored;
/// negated patterns (`!x`) never match.
pub fn glob_match(pattern: &str, rel: &str) -> bool {
    let p = pattern.trim().trim_start_matches("./").trim_end_matches('/');
    if p.starts_with('!') || p.is_empty() {
        return false;
    }
    let ps: Vec<&str> = p.split('/').filter(|s| !s.is_empty() && *s != ".").collect();
    let rs: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
    fn go(p: &[&str], r: &[&str]) -> bool {
        match (p.first(), r.first()) {
            (None, None) => true,
            (Some(&"**"), _) => go(&p[1..], r) || (!r.is_empty() && go(p, &r[1..])),
            (Some(a), Some(b)) => seg(a, b) && go(&p[1..], &r[1..]),
            _ => false,
        }
    }
    fn seg(p: &str, s: &str) -> bool {
        match p.find('*') {
            None => p == s,
            Some(i) => {
                let (pre, rest) = (&p[..i], &p[i + 1..]);
                s.len() >= pre.len() && s.starts_with(pre) && (0..=s.len() - pre.len()).any(|k| seg(rest, &s[pre.len() + k..]))
            }
        }
    }
    go(&ps, &rs)
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches(|c| c == '"' || c == '\'' || c == ',').trim().to_string()
}

/// Items of a top-level YAML list `key:` (block style `- item` or flow style `[a, b]`).
fn yaml_list(text: &str, key: &str) -> Vec<String> {
    let mut out = vec![];
    let mut inside = false;
    for line in text.lines() {
        let t = line.trim_end();
        if !inside {
            if let Some(rest) = t.strip_prefix(&format!("{key}:")) {
                let rest = rest.trim();
                if rest.starts_with('[') {
                    return rest.trim_matches(|c| c == '[' || c == ']').split(',').map(unquote).filter(|s| !s.is_empty()).collect();
                }
                inside = true;
            }
            continue;
        }
        let tt = t.trim_start();
        if tt.is_empty() || tt.starts_with('#') {
            continue;
        }
        if let Some(item) = tt.strip_prefix("- ") {
            out.push(unquote(item.split(" #").next().unwrap_or(item)));
        } else if !t.starts_with(' ') && !t.starts_with('\t') {
            break;
        }
    }
    out
}

fn cargo_members(text: &str) -> Option<Vec<String>> {
    let start = text.find("[workspace]")?;
    let body = &text[start + "[workspace]".len()..];
    let body = body.split("\n[").next().unwrap_or(body);
    let Some(m) = body.find("members") else { return Some(vec![]) };
    let rest = &body[m..];
    let open = rest.find('[')?;
    let close = rest[open..].find(']')? + open;
    Some(rest[open + 1..close].split(',').map(unquote).filter(|s| !s.is_empty()).collect())
}

fn gradle_includes(text: &str) -> Vec<String> {
    let mut out = vec![];
    for line in text.lines() {
        let t = line.trim();
        if !t.starts_with("include") || t.starts_with("includeBuild") {
            continue;
        }
        let args = t.trim_start_matches("include").trim().trim_start_matches('(').trim_end_matches(')');
        for a in args.split(',') {
            let a = unquote(a);
            let a = a.trim_start_matches(':').replace(':', "/");
            if !a.is_empty() {
                out.push(a);
            }
        }
    }
    out
}

fn go_uses(text: &str) -> Vec<String> {
    let mut out = vec![];
    let mut block = false;
    for line in text.lines() {
        let t = line.split("//").next().unwrap_or("").trim();
        if block {
            if t == ")" {
                block = false;
            } else if !t.is_empty() {
                out.push(unquote(t));
            }
        } else if let Some(rest) = t.strip_prefix("use") {
            let rest = rest.trim();
            if rest == "(" {
                block = true;
            } else if !rest.is_empty() {
                out.push(unquote(rest));
            }
        }
    }
    out.into_iter().map(|s| s.trim_start_matches("./").to_string()).filter(|s| !s.is_empty() && s != ".").collect()
}
