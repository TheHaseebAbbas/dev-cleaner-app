pub mod analytics;
pub mod cleaner;
pub mod global;
pub mod graph;
pub mod history;
pub mod inuse;
pub mod model;
pub mod plan;
pub mod recommend;
pub mod references;
pub mod rules;
pub mod safety;
pub mod ruletest;
pub mod scanner;
pub mod schedule;
pub mod settings;
pub mod trash_bin;
pub mod workspace;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_v2;
#[cfg(test)]
mod tests_v3;
