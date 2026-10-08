use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, time::Instant};
mod search;
mod server;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

#[derive(Deserialize)]
struct Raw {
    comps: serde_json::Map<String, serde_json::Value>,
    perks: serde_json::Map<String, serde_json::Value>,
}
#[derive(Clone, Deserialize)]
struct Rank {
    threshold: usize,
    cost: usize,
    #[serde(rename = "ancientOnly")]
    ancient_only: u8,
}
struct Perk {
    name: String,
    ranks: Vec<Rank>,
    double: bool,
}
struct Mat {
    name: String,
    ancient: bool,
    contributions: [Vec<(usize, usize, usize)>; 3],
}
struct Data {
    perks: Vec<Perk>,
    mats: Vec<Mat>,
}
impl Data {
    fn load() -> Self {
        let raw: Raw = serde_json::from_str(include_str!("../data/wiki.json")).unwrap();
        let perks: Vec<Perk> = raw
            .perks
            .iter()
            .map(|(name, v)| Perk {
                name: name.clone(),
                ranks: serde_json::from_value(v["ranks"].clone()).unwrap(),
                double: v["doubleslot"] == true,
            })
            .collect();
        let mats = raw
            .comps
            .iter()
            .map(|(name, v)| Mat {
                name: name.clone(),
                ancient: v["ancient"] == true,
                contributions: ["weapon", "armour", "tool"].map(|g| {
                    v[g].as_array()
                        .unwrap()
                        .iter()
                        .map(|p| {
                            (
                                perks
                                    .iter()
                                    .position(|q| q.name == p["perk"].as_str().unwrap())
                                    .unwrap(),
                                p["base"].as_u64().unwrap() as usize,
                                p["roll"].as_u64().unwrap() as usize,
                            )
                        })
                        .collect()
                }),
            })
            .collect();
        Self { perks, mats }
    }
}
#[derive(Clone, Copy, Debug)]
struct State {
    perk: usize,
    rank: usize,
    cost: usize,
    p: f64,
}
fn dice(rolls: &[usize]) -> Vec<f64> {
    let mut a = vec![1.0];
    for &r in rolls {
        let mut b = vec![0.; a.len() + r - 1];
        let mut sum = 0.;
        for i in 0..b.len() {
            if i < a.len() {
                sum += a[i];
            }
            if i >= r {
                sum -= a[i - r];
            }
            b[i] = sum / r as f64;
        }
        a = b;
    }
    a
}
fn sort(a: &mut [State], lo: usize, hi: usize) {
    let pivot = a[(lo + hi) / 2];
    a[(lo + hi) / 2] = a[hi];
    a[hi] = pivot;
    let mut c = lo;
    for i in lo..hi {
        if (a[i].cost as isize - pivot.cost as isize) < (i & 1) as isize {
            a.swap(i, c);
            c += 1;
        }
    }
    a[hi] = a[c];
    a[c] = pivot;
    if c > lo + 1 {
        sort(a, lo, c - 1)
    }
    if c + 1 < hi {
        sort(a, c + 1, hi)
    }
}
struct Engine<'a> {
    data: &'a Data,
    kind: usize,
    ancient: bool,
    targets: Vec<(usize, usize)>,
    levels: Vec<usize>,
    budgets: Arc<Vec<Vec<f64>>>,
    cache: HashMap<(usize, usize, Vec<usize>), Vec<State>>,
    exact: bool,
    blacklist: Vec<usize>,
    blacklist_empty: bool,
    cancel: Arc<AtomicBool>,
}
impl<'a> Engine<'a> {
    fn new(
        data: &'a Data,
        kind: usize,
        ancient: bool,
        targets: Vec<(usize, usize)>,
        levels: Vec<usize>,
    ) -> Self {
        let budgets = levels
            .iter()
            .map(|&l| {
                let mut d = dice(&vec![20 + l / 2; if ancient { 6 } else { 5 }]);
                d[l] += d[..l].iter().sum::<f64>();
                d[..l].fill(0.);
                let mut b = vec![0.; 128];
                for i in (1..d.len()).step_by(5) {
                    b[(i - 1) / 5] = d[i..(i + 5).min(d.len())].iter().sum();
                }
                for i in (0..127).rev() {
                    b[i] += b[i + 1];
                }
                b
            })
            .collect();
        Self {
            data,
            kind,
            ancient,
            targets,
            levels,
            budgets: Arc::new(budgets),
            cache: HashMap::new(),
            exact: false,
            blacklist: vec![],
            blacklist_empty: false,
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }
    fn fork(&self) -> Self {
        Self {
            data: self.data,
            kind: self.kind,
            ancient: self.ancient,
            targets: self.targets.clone(),
            levels: self.levels.clone(),
            budgets: self.budgets.clone(),
            cache: HashMap::new(),
            exact: self.exact,
            blacklist: self.blacklist.clone(),
            blacklist_empty: self.blacklist_empty,
            cancel: self.cancel.clone(),
        }
    }
    fn matches(&self, picked: &[Option<State>]) -> bool {
        (!self.exact || picked.len() == self.targets.len())
            && (!self.blacklist_empty || picked.len() != self.targets.len())
            && picked
                .iter()
                .flatten()
                .all(|s| !self.blacklist.contains(&s.perk))
            && self
                .targets
                .iter()
                .all(|&(p, r)| picked.iter().flatten().any(|s| s.perk == p && s.rank >= r))
    }
    fn distributions(&mut self, mats: &[usize]) -> Vec<Vec<State>> {
        let mut entries: Vec<(usize, usize, Vec<usize>)> = Vec::new();
        for &m in mats {
            let mat = &self.data.mats[m];
            for &(p, b, r) in &mat.contributions[self.kind] {
                // Wiki stops all accumulation once twenty distinct perks have been registered.
                if entries.len() >= 20 {
                    continue;
                }
                let (b, r) = if self.ancient && !mat.ancient {
                    (b * 4 / 5, r * 4 / 5)
                } else {
                    (b, r)
                };
                if let Some(e) = entries.iter_mut().find(|e| e.0 == p) {
                    e.1 += b;
                    e.2.push(r);
                } else {
                    entries.push((p, b, vec![r]));
                }
            }
        }
        entries
            .into_iter()
            .map(|(p, base, mut rolls)| {
                rolls.sort_unstable();
                let key = (p, base, rolls);
                self.cache
                    .entry(key.clone())
                    .or_insert_with(|| {
                        let d = dice(&key.2);
                        let ranks = &self.data.perks[p].ranks;
                        let mut thresholds = vec![0];
                        thresholds.extend(
                            ranks
                                .iter()
                                .filter(|r| self.ancient || r.ancient_only == 0)
                                .map(|r| r.threshold),
                        );
                        thresholds.push(9999);
                        thresholds
                            .windows(2)
                            .enumerate()
                            .filter_map(|(rank, t)| {
                                let low = t[0].saturating_sub(base).min(d.len());
                                let high = t[1].saturating_sub(base).min(d.len());
                                let prob = d[low..high].iter().sum::<f64>();
                                (prob > 0.).then_some(State {
                                    perk: p,
                                    rank,
                                    cost: if rank == 0 { 0 } else { ranks[rank - 1].cost },
                                    p: prob,
                                })
                            })
                            .collect()
                    })
                    .clone()
            })
            .collect()
    }
    fn evaluate(&mut self, mats: &[usize]) -> Option<Row> {
        let distributions = self.distributions(mats);
        let empty = self.empty_probabilities(&distributions);
        self.evaluate_distributions(mats, &distributions, &empty)
    }
    fn empty_probabilities(&self, distributions: &[Vec<State>]) -> Vec<[f64; 2]> {
        let mut empty = [1.; 128];
        let mut consumed = [0.; 128];
        for d in distributions {
            for (i, v) in empty.iter_mut().enumerate() {
                let budget = i * 5 + 1;
                *v *= d
                    .iter()
                    .filter(|s| s.cost == 0 || s.cost >= budget)
                    .map(|s| s.p)
                    .sum::<f64>();
                let affordable = d
                    .iter()
                    .filter(|s| s.cost > 0 && s.cost < budget)
                    .map(|s| s.p)
                    .sum::<f64>();
                consumed[i] += (1. - consumed[i]) * affordable;
            }
        }
        let mut prev = 0.;
        let changes = empty
            .iter()
            .enumerate()
            .filter_map(|(i, &v)| {
                let delta = v - prev;
                prev = v;
                (delta != 0.).then_some((i, delta))
            })
            .collect::<Vec<_>>();
        self.budgets
            .iter()
            .map(|budget| {
                [
                    changes
                        .iter()
                        .map(|&(i, v)| v * budget[i])
                        .sum::<f64>()
                        .max(0.),
                    (0..127)
                        .map(|i| consumed[i] * (budget[i] - budget[i + 1]))
                        .sum::<f64>(),
                ]
            })
            .collect()
    }
    fn evaluate_distributions(
        &self,
        mats: &[usize],
        distributions: &[Vec<State>],
        empty: &[[f64; 2]],
    ) -> Option<Row> {
        if self.cancel.load(Ordering::Relaxed) {
            return None;
        }
        if self.targets.iter().any(|&(p, r)| {
            !distributions
                .iter()
                .any(|d| d.iter().any(|s| s.perk == p && s.rank >= r))
        }) {
            return None;
        }
        let mut hit = [0.; 128];
        let mut filtered = distributions.to_vec();
        for d in &mut filtered {
            if let Some(&(_, min)) = self.targets.iter().find(|t| t.0 == d[0].perk) {
                d.retain(|s| s.rank >= min);
            }
        }
        fn walk(
            e: &Engine,
            ds: &[Vec<State>],
            depth: usize,
            states: &mut Vec<State>,
            prob: f64,
            hit: &mut [f64; 128],
        ) {
            if depth < ds.len() {
                for &s in &ds[depth] {
                    states.push(s);
                    walk(e, ds, depth + 1, states, prob * s.p, hit);
                    states.pop();
                }
                return;
            }
            let n = states.len();
            if n == 0 {
                return;
            }
            let mut storage = [State {
                perk: 0,
                rank: 0,
                cost: 0,
                p: 0.,
            }; 20];
            storage[..n].copy_from_slice(states);
            let sorted = &mut storage[..n];
            sort(sorted, 0, n - 1);
            // Sweep only at affordability breakpoints; every budget in a range has the same result.
            let min_cost: usize = e
                .targets
                .iter()
                .map(|&(p, _)| states.iter().find(|s| s.perk == p).unwrap().cost)
                .sum();
            let mut b = 1 + min_cost.div_ceil(5) * 5;
            while b < 640 {
                let mut rem = b;
                let mut picked = [None, None];
                let mut count = 0;
                let mut next = 640;
                for s in sorted.iter().rev() {
                    if s.cost == 0 {
                        continue;
                    }
                    if rem > s.cost {
                        picked[count] = Some(*s);
                        count += 1;
                        rem -= s.cost;
                        if count == 2 {
                            break;
                        }
                    } else {
                        next = next.min(s.cost + 1 + (b - rem));
                    }
                }
                let mut len = count;
                if picked.iter().flatten().any(|s| e.data.perks[s.perk].double) {
                    len = len.min(1);
                }
                let matches = e.matches(&picked[..len]);
                let end = next.min(640);
                if matches {
                    for i in ((b - 1) / 5)..((end - 1).div_ceil(5)).min(128) {
                        hit[i] += prob;
                    }
                }
                b = 1 + ((end - 1).div_ceil(5)) * 5;
            }
        }
        walk(
            self,
            &filtered,
            0,
            &mut Vec::with_capacity(20),
            1.,
            &mut hit,
        );
        let changes = |values: &[f64; 128]| {
            let mut prev = 0.;
            values
                .iter()
                .enumerate()
                .filter_map(|(i, &v)| {
                    let delta = v - prev;
                    prev = v;
                    (delta != 0.).then_some((i, delta))
                })
                .collect::<Vec<_>>()
        };
        let hit_changes = changes(&hit);
        let mut best = 0.;
        let mut best_levels = Vec::new();
        let mut no_effect = 0.;
        for (idx, budget) in self.budgets.iter().enumerate() {
            let h = hit_changes.iter().map(|&(i, v)| v * budget[i]).sum::<f64>();
            let [ne, consumed] = empty[idx];
            let p = if consumed > 0. {
                (h / consumed).clamp(0., 1.)
            } else {
                0.
            };
            if p > best * (1. + 1e-6) {
                best = p;
                best_levels.clear();
                best_levels.push(self.levels[idx]);
                no_effect = ne;
            } else if best > 0. && (p - best).abs() <= best * 1e-6 {
                best_levels.push(self.levels[idx]);
            }
        }
        (best > 0.).then(|| Row {
            materials: mats
                .iter()
                .map(|&m| self.data.mats[m].name.clone())
                .collect(),
            prob_per_gizmo: best,
            best_levels,
            no_effect_prob: no_effect,
            permutations_tried: 1,
            top_result_key: String::new(),
            gizmo_type: ["weapon", "armour", "tool"][self.kind].into(),
            ancient: self.ancient,
        })
    }
    fn exhaustive(&mut self, mats: &[usize]) -> Option<Row> {
        if self.cancel.load(Ordering::Relaxed) {
            return None;
        }
        let mut distinct: Vec<(usize, usize)> = Vec::new();
        for &m in mats {
            if let Some(pair) = distinct.iter_mut().find(|p| p.0 == m) {
                pair.1 += 1;
            } else {
                distinct.push((m, 1));
            }
        }
        let mut seen = std::collections::HashSet::new();
        let mut best: Option<Row> = None;
        let mut tried = 0;
        let distributions = self.distributions(mats);
        let mut union = std::collections::HashSet::new();
        for &m in mats {
            for &(p, _, _) in &self.data.mats[m].contributions[self.kind] {
                union.insert(p);
            }
        }
        if union.len() >= 20 {
            fn slots(
                e: &mut Engine,
                counts: &mut [(usize, usize)],
                seq: &mut Vec<usize>,
                size: usize,
                best: &mut Option<Row>,
                tried: &mut usize,
            ) {
                if e.cancel.load(Ordering::Relaxed) {
                    return;
                }
                if seq.len() == size {
                    *tried += 1;
                    if let Some(row) = e.evaluate(seq) {
                        if best
                            .as_ref()
                            .is_none_or(|b| row.prob_per_gizmo > b.prob_per_gizmo)
                        {
                            *best = Some(row);
                        }
                    }
                    return;
                }
                for i in 0..counts.len() {
                    if counts[i].1 == 0 {
                        continue;
                    }
                    counts[i].1 -= 1;
                    seq.push(counts[i].0);
                    slots(e, counts, seq, size, best, tried);
                    seq.pop();
                    counts[i].1 += 1;
                }
            }
            slots(
                self,
                &mut distinct,
                &mut Vec::new(),
                mats.len(),
                &mut best,
                &mut tried,
            );
            if let Some(row) = &mut best {
                row.permutations_tried = tried;
            }
            return best;
        }
        let empty = self.empty_probabilities(&distributions);
        let target_costs: Vec<(usize, usize)> = distributions
            .iter()
            .flat_map(|d| d.iter())
            .filter(|s| {
                self.targets
                    .iter()
                    .any(|&(p, r)| p == s.perk && s.rank >= r)
            })
            .map(|s| (s.perk, s.cost))
            .collect();
        let sensitive = distributions.iter().flat_map(|d| d.iter()).any(|s| {
            target_costs
                .iter()
                .any(|&(p, c)| s.perk != p && s.cost == c)
        });
        if distributions.len() < 20 && !sensitive && self.targets.len() == 2 {
            return self.evaluate_distributions(mats, &distributions, &empty);
        }
        fn visit(
            e: &Engine,
            distributions: &[Vec<State>],
            empty: &[[f64; 2]],
            ds: &mut [(usize, usize)],
            depth: usize,
            seen: &mut std::collections::HashSet<Vec<usize>>,
            best: &mut Option<Row>,
            tried: &mut usize,
        ) {
            if depth < ds.len() {
                for i in depth..ds.len() {
                    ds.swap(i, depth);
                    visit(e, distributions, empty, ds, depth + 1, seen, best, tried);
                    ds.swap(i, depth);
                }
                return;
            }
            let mats: Vec<usize> = ds
                .iter()
                .flat_map(|&(m, n)| std::iter::repeat_n(m, n))
                .collect();
            let mut order = Vec::new();
            for &m in &mats {
                for &(p, _, _) in &e.data.mats[m].contributions[e.kind] {
                    if !order.contains(&p) {
                        order.push(p);
                    }
                }
            }
            if !seen.insert(order.clone()) {
                return;
            }
            *tried += 1;
            let reordered = order
                .iter()
                .map(|p| {
                    distributions
                        .iter()
                        .find(|d| d[0].perk == *p)
                        .unwrap()
                        .clone()
                })
                .collect::<Vec<_>>();
            if let Some(row) = e.evaluate_distributions(&mats, &reordered, empty) {
                if best
                    .as_ref()
                    .is_none_or(|b| row.prob_per_gizmo > b.prob_per_gizmo)
                {
                    *best = Some(row);
                }
            }
        }
        visit(
            self,
            &distributions,
            &empty,
            &mut distinct,
            0,
            &mut seen,
            &mut best,
            &mut tried,
        );
        if let Some(row) = &mut best {
            row.permutations_tried = tried;
        }
        best
    }
    fn label(&mut self, row: &Row) -> String {
        let mats = row
            .materials
            .iter()
            .map(|n| self.data.mats.iter().position(|m| &m.name == n).unwrap())
            .collect::<Vec<_>>();
        let ds = self.distributions(&mats);
        let lvl = self
            .levels
            .iter()
            .position(|l| *l == row.best_levels[0])
            .unwrap();
        let budget = &self.budgets[lvl];
        let mut outcomes: HashMap<Vec<(usize, usize)>, f64> = HashMap::new();
        fn rec(
            e: &Engine,
            ds: &[Vec<State>],
            seq: &mut Vec<State>,
            prob: f64,
            budget: &[f64],
            out: &mut HashMap<Vec<(usize, usize)>, f64>,
        ) {
            if seq.len() < ds.len() {
                for &s in &ds[seq.len()] {
                    seq.push(s);
                    rec(e, ds, seq, prob * s.p, budget, out);
                    seq.pop();
                }
                return;
            }
            let mut a = seq.clone();
            let n = a.len();
            if n == 0 {
                return;
            }
            sort(&mut a, 0, n - 1);
            for i in 0..127 {
                let bp = budget[i] - budget[i + 1];
                if bp <= 0. {
                    continue;
                }
                let mut rem = 1 + i * 5;
                let mut picked = Vec::new();
                for s in a.iter().rev() {
                    if s.cost > 0 && rem > s.cost {
                        picked.push(Some(*s));
                        rem -= s.cost;
                        if picked.len() == 2 {
                            break;
                        }
                    }
                }
                if picked.iter().flatten().any(|s| e.data.perks[s.perk].double) {
                    picked.truncate(1);
                }
                if e.matches(&picked) {
                    let key = picked.iter().flatten().map(|s| (s.perk, s.rank)).collect();
                    *out.entry(key).or_default() += prob * bp;
                }
            }
        }
        // Non-matching target ranks cannot contribute to any requested label.
        let ds = ds
            .into_iter()
            .map(|d| {
                d.into_iter()
                    .filter(|s| {
                        self.targets
                            .iter()
                            .all(|&(p, r)| p != s.perk || s.rank >= r)
                    })
                    .collect()
            })
            .collect::<Vec<_>>();
        rec(self, &ds, &mut Vec::new(), 1., budget, &mut outcomes);
        let key = outcomes
            .into_iter()
            .max_by(|(a, p), (b, q)| {
                a.len()
                    .cmp(&b.len())
                    .then_with(|| p.total_cmp(q))
                    .then_with(|| b.cmp(a))
            })
            .map(|(k, _)| k)
            .unwrap_or_default();
        key.iter()
            .map(|&(p, r)| {
                if self.data.perks[p].ranks.len() > 1 {
                    format!("{} {}", self.data.perks[p].name, r)
                } else {
                    self.data.perks[p].name.clone()
                }
            })
            .collect::<Vec<_>>()
            .join(",")
    }
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Row {
    materials: Vec<String>,
    prob_per_gizmo: f64,
    best_levels: Vec<usize>,
    no_effect_prob: f64,
    permutations_tried: usize,
    top_result_key: String,
    gizmo_type: String,
    ancient: bool,
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let data = Data::load();
    if args.len() == 1 || args.get(1).map(String::as_str) == Some("serve") {
        server::run(data);
        return;
    }
    if args.get(1).map(String::as_str) == Some("request") {
        let request = serde_json::from_str(&std::fs::read_to_string(&args[2]).unwrap()).unwrap();
        let response = search::run(&data, request, Arc::new(AtomicBool::new(false))).unwrap();
        println!("{}", serde_json::to_string(&response).unwrap());
        return;
    }
    let target = |n: &str| data.perks.iter().position(|p| p.name == n).unwrap();
    let levels = if args.iter().any(|s| s == "--all-levels") {
        (1..=137).collect()
    } else {
        vec![137]
    };
    let mut engine = Engine::new(
        &data,
        1,
        true,
        vec![(target("Impatient"), 4), (target("Mobile"), 1)],
        levels,
    );
    if args.get(1).map(String::as_str) == Some("evaluate") {
        let names: Vec<String> = serde_json::from_str(&args[2]).unwrap();
        let mats = names
            .iter()
            .filter(|n| !n.is_empty())
            .map(|n| data.mats.iter().position(|m| &m.name == n).unwrap())
            .collect::<Vec<_>>();
        println!(
            "{}",
            serde_json::to_string(&engine.evaluate(&mats)).unwrap()
        );
        return;
    }
    let start = Instant::now();
    let pool: Vec<usize> = data
        .mats
        .iter()
        .enumerate()
        .filter(|(_, m)| {
            !m.contributions[1].is_empty()
                && (!args.iter().any(|a| a == "--contributors")
                    || m.contributions[1]
                        .iter()
                        .any(|c| engine.targets.iter().any(|t| t.0 == c.0)))
        })
        .map(|(i, _)| i)
        .collect();
    let maxima: Vec<[usize; 2]> = pool
        .iter()
        .map(|&m| {
            std::array::from_fn(|t| {
                data.mats[m].contributions[1]
                    .iter()
                    .filter(|c| c.0 == engine.targets[t].0)
                    .map(|&(_, b, r)| {
                        if data.mats[m].ancient {
                            b + r - 1
                        } else {
                            b * 4 / 5 + r * 4 / 5 - 1
                        }
                    })
                    .sum()
            })
        })
        .collect();
    let mut suffix = vec![[0; 2]; pool.len() + 1];
    for i in (0..pool.len()).rev() {
        for t in 0..2 {
            suffix[i][t] = suffix[i + 1][t].max(maxima[i][t]);
        }
    }
    let thresholds = [
        data.perks[engine.targets[0].0].ranks[3].threshold,
        data.perks[engine.targets[1].0].ranks[0].threshold,
    ];
    let mut recipes = Vec::new();
    fn enumerate(
        pool: &[usize],
        maxima: &[[usize; 2]],
        suffix: &[[usize; 2]],
        thresholds: [usize; 2],
        first: usize,
        mats: &mut Vec<usize>,
        sum: [usize; 2],
        out: &mut Vec<Vec<usize>>,
    ) {
        if (0..2).all(|t| sum[t] >= thresholds[t]) {
            out.push(mats.clone());
        }
        if mats.len() == 9 {
            return;
        }
        let remaining = 9 - mats.len();
        if (0..2).any(|t| sum[t] + remaining * suffix[first][t] < thresholds[t]) {
            return;
        }
        for i in first..pool.len() {
            let s = [sum[0] + maxima[i][0], sum[1] + maxima[i][1]];
            if (0..2).any(|t| s[t] + (remaining - 1) * suffix[i][t] < thresholds[t]) {
                continue;
            }
            mats.push(pool[i]);
            enumerate(pool, maxima, suffix, thresholds, i, mats, s, out);
            mats.pop();
        }
    }
    enumerate(
        &pool,
        &maxima,
        &suffix,
        thresholds,
        0,
        &mut Vec::new(),
        [0, 0],
        &mut recipes,
    );
    eprintln!(
        "{} bound survivors enumerated in {:?}",
        recipes.len(),
        start.elapsed()
    );
    let rows: Vec<Row> = recipes
        .par_chunks(32)
        .flat_map(|chunk| {
            let mut e = engine.fork();
            chunk
                .iter()
                .filter_map(|m| {
                    if args.iter().any(|a| a == "--canonical") {
                        e.evaluate(m)
                    } else {
                        e.exhaustive(m)
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect();
    eprintln!(
        "{} matches in {:?}; {} unique perk orderings",
        rows.len(),
        start.elapsed(),
        rows.iter().map(|r| r.permutations_tried).sum::<usize>()
    );
    if let Some(i) = args.iter().position(|s| s == "--out") {
        std::fs::write(&args[i + 1], serde_json::to_vec(&rows).unwrap()).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wiki_fixtures() {
        let data = Data::load();
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("../data/golden.json")).unwrap();
        for f in fixtures.as_array().unwrap() {
            let mats = f["mats"]
                .as_array()
                .unwrap()
                .iter()
                .map(|n| {
                    data.mats
                        .iter()
                        .position(|m| m.name == n.as_str().unwrap())
                        .unwrap()
                })
                .collect::<Vec<_>>();
            let targets = f["targets"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| {
                    (
                        data.perks
                            .iter()
                            .position(|p| p.name == t[0].as_str().unwrap())
                            .unwrap(),
                        t[1].as_u64().unwrap() as usize,
                    )
                })
                .collect::<Vec<_>>();
            let mut e = Engine::new(
                &data,
                f["kind"].as_u64().unwrap() as usize,
                f["ancient"].as_bool().unwrap(),
                targets.clone(),
                vec![137],
            );
            let actual = e.distributions(&mats);
            let expected = f["distributions"].as_array().unwrap();
            assert_eq!(actual.len(), expected.len());
            for (actual, expected) in actual.iter().zip(expected) {
                let expected = expected.as_array().unwrap();
                assert_eq!(actual.len(), expected.len());
                for (a, b) in actual.iter().zip(expected) {
                    assert_eq!(data.perks[a.perk].name, b["perk"].as_str().unwrap());
                    assert_eq!(a.rank, b["rank"].as_u64().unwrap() as usize);
                    assert_eq!(a.cost, b["cost"].as_u64().unwrap() as usize);
                    assert!((a.p - b["probability"].as_f64().unwrap()).abs() < 1e-12);
                }
            }
            let outcomes = f["outcomes"].as_object().unwrap();
            let no_effect = outcomes.get("").and_then(|v| v.as_f64()).unwrap_or(0.);
            let probability = outcomes
                .iter()
                .filter(|(key, _)| {
                    targets.iter().all(|&(p, r)| {
                        key.split(',').any(|token| {
                            token == data.perks[p].name && r == 1
                                || token
                                    .strip_prefix(&(data.perks[p].name.clone() + " "))
                                    .and_then(|s| s.parse::<usize>().ok())
                                    .is_some_and(|rank| rank >= r)
                        })
                    })
                })
                .map(|(_, v)| v.as_f64().unwrap())
                .sum::<f64>()
                / (1. - no_effect);
            let row = e.evaluate(&mats);
            assert!(
                (row.as_ref().map_or(0., |r| r.prob_per_gizmo) - probability).abs() < 1e-11,
                "{}",
                f["mats"]
            );
        }
    }
    #[test]
    fn two_dice() {
        assert_eq!(dice(&[2, 2]), vec![0.25, 0.5, 0.25]);
    }
}
