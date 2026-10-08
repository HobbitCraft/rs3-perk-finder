use super::*;
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    name: String,
    min_rank: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    targets: Vec<Target>,
    gizmo_types: Vec<String>,
    ancient_modes: Vec<bool>,
    inv_level: usize,
    max_distinct_mats: Option<usize>,
    #[serde(default)]
    exact_count: bool,
    #[serde(default)]
    blacklist: Vec<String>,
    #[serde(default)]
    blacklist_empty: bool,
    #[serde(default)]
    min_level: Option<usize>,
    #[serde(default)]
    contributors_only: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub rows: Vec<Row>,
    pub search_ms: f64,
    pub survivors: usize,
    pub logical_total: u64,
    pub cancelled: bool,
}
fn choose(n: usize, k: usize) -> u64 {
    if k > n {
        return 0;
    }
    (1..=k.min(n - k)).fold(1, |v, i| v * (n + 1 - i) as u64 / i as u64)
}
pub fn run(data: &Data, request: Request, cancel: Arc<AtomicBool>) -> Result<Response, String> {
    let started = Instant::now();
    if request.targets.is_empty()
        || request.targets.len() > 2
        || request.inv_level == 0
        || request.inv_level > 137
    {
        return Err("Choose one or two targets and an effective level from 1 to 137".into());
    }
    let targets = request
        .targets
        .iter()
        .map(|t| {
            let p = data
                .perks
                .iter()
                .position(|p| p.name == t.name)
                .ok_or_else(|| format!("Unknown perk {}", t.name))?;
            if t.min_rank == 0 || t.min_rank > data.perks[p].ranks.len() {
                return Err("Invalid target rank".into());
            }
            Ok((p, t.min_rank))
        })
        .collect::<Result<Vec<_>, String>>()?;
    if targets.len() == 2
        && (targets[0].0 == targets[1].0 || targets.iter().any(|t| data.perks[t.0].double))
    {
        return Err("Targets must be different, single-slot perks".into());
    }
    let min_level = request.min_level.unwrap_or(1);
    if min_level == 0 || min_level > request.inv_level {
        return Err("Invalid minimum level".into());
    }
    let max_distinct = request.max_distinct_mats.unwrap_or(9);
    if !(1..=9).contains(&max_distinct) {
        return Err("Material cap must be 1 to 9".into());
    }
    let mut response = Response {
        rows: vec![],
        search_ms: 0.,
        survivors: 0,
        logical_total: 0,
        cancelled: false,
    };
    for kind_name in &request.gizmo_types {
        let kind = ["weapon", "armour", "tool"]
            .iter()
            .position(|s| s == kind_name)
            .ok_or("Invalid gizmo type")?;
        for &ancient in &request.ancient_modes {
            if targets
                .iter()
                .any(|&(p, r)| !ancient && data.perks[p].ranks[r - 1].ancient_only != 0)
            {
                continue;
            }
            let mut engine = Engine::new(
                data,
                kind,
                ancient,
                targets.clone(),
                (min_level..=request.inv_level).collect(),
            );
            engine.exact = request.exact_count;
            engine.blacklist_empty = request.blacklist_empty;
            engine.cancel = cancel.clone();
            engine.blacklist = request
                .blacklist
                .iter()
                .filter_map(|n| data.perks.iter().position(|p| &p.name == n))
                .filter(|p| !targets.iter().any(|t| t.0 == *p))
                .collect();
            let pool = data
                .mats
                .iter()
                .enumerate()
                .filter(|(_, m)| {
                    (ancient || !m.ancient)
                        && !m.contributions[kind].is_empty()
                        && (!request.contributors_only
                            || m.contributions[kind]
                                .iter()
                                .any(|c| targets.iter().any(|t| t.0 == c.0)))
                })
                .map(|(i, _)| i)
                .collect::<Vec<_>>();
            let slots = if ancient { 9 } else { 5 };
            response.logical_total += (1..=max_distinct.min(slots))
                .map(|d| choose(pool.len(), d) * choose(slots, d))
                .sum::<u64>();
            let maxima: Vec<[usize; 2]> = pool
                .iter()
                .map(|&m| {
                    std::array::from_fn(|t| {
                        if t >= targets.len() {
                            0
                        } else {
                            data.mats[m].contributions[kind]
                                .iter()
                                .filter(|c| c.0 == targets[t].0)
                                .map(|&(_, b, r)| {
                                    if ancient && !data.mats[m].ancient {
                                        b * 4 / 5 + (r * 4 / 5).saturating_sub(1)
                                    } else {
                                        b + r.saturating_sub(1)
                                    }
                                })
                                .sum()
                        }
                    })
                })
                .collect();
            let mut suffix = vec![[0; 2]; pool.len() + 1];
            for i in (0..pool.len()).rev() {
                for t in 0..2 {
                    suffix[i][t] = suffix[i + 1][t].max(maxima[i][t]);
                }
            }
            let thresholds = std::array::from_fn(|t| {
                if t >= targets.len() {
                    0
                } else {
                    data.perks[targets[t].0].ranks[targets[t].1 - 1].threshold
                }
            });
            let mut recipes = Vec::new();
            struct Enumerator<'a> {
                pool: &'a [usize],
                maxima: &'a [[usize; 2]],
                suffix: &'a [[usize; 2]],
                thresholds: [usize; 2],
                slots: usize,
                cap: usize,
                cancel: &'a AtomicBool,
            }
            impl Enumerator<'_> {
                fn walk(
                    &self,
                    first: usize,
                    mats: &mut Vec<usize>,
                    distinct: usize,
                    sum: [usize; 2],
                    out: &mut Vec<Vec<usize>>,
                ) -> Result<(), String> {
                    if self.cancel.load(Ordering::Relaxed) {
                        return Ok(());
                    }
                    if (0..2).all(|t| sum[t] >= self.thresholds[t]) {
                        if out.len() >= 2_000_000 {
                            return Err("Over two million viable recipes. Reduce the distinct-material cap; no partial result is reported as complete.".into());
                        }
                        out.push(mats.clone());
                    }
                    if mats.len() == self.slots {
                        return Ok(());
                    }
                    let remaining = self.slots - mats.len();
                    if (0..2)
                        .any(|t| sum[t] + remaining * self.suffix[first][t] < self.thresholds[t])
                    {
                        return Ok(());
                    }
                    for i in first..self.pool.len() {
                        let nd = distinct + usize::from(mats.last() != Some(&self.pool[i]));
                        if nd > self.cap {
                            continue;
                        }
                        let s = [sum[0] + self.maxima[i][0], sum[1] + self.maxima[i][1]];
                        if (0..2).any(|t| {
                            s[t] + (remaining - 1) * self.suffix[i][t] < self.thresholds[t]
                        }) {
                            continue;
                        }
                        mats.push(self.pool[i]);
                        self.walk(i, mats, nd, s, out)?;
                        mats.pop();
                    }
                    Ok(())
                }
            }
            Enumerator {
                pool: &pool,
                maxima: &maxima,
                suffix: &suffix,
                thresholds,
                slots,
                cap: max_distinct,
                cancel: &cancel,
            }
            .walk(0, &mut Vec::new(), 0, [0, 0], &mut recipes)?;
            response.survivors += recipes.len();
            let mut rows: Vec<Row> = recipes
                .par_chunks(32)
                .flat_map(|chunk| {
                    let mut e = engine.fork();
                    chunk
                        .iter()
                        .filter_map(|m| {
                            let mut row = e.exhaustive(m)?;
                            // If each target has just one qualifying rank and different costs, its output label is fixed.
                            if engine.exact
                                && targets.len() == 1
                                && data.perks[targets[0].0].ranks.len() == targets[0].1
                            {
                                let (p, r) = targets[0];
                                row.top_result_key = if data.perks[p].ranks.len() > 1 {
                                    format!("{} {}", data.perks[p].name, r)
                                } else {
                                    data.perks[p].name.clone()
                                };
                            } else if targets.len() == 2
                                && targets.iter().all(|&(p, r)| data.perks[p].ranks.len() == r)
                                && data.perks[targets[0].0].ranks[targets[0].1 - 1].cost
                                    != data.perks[targets[1].0].ranks[targets[1].1 - 1].cost
                            {
                                let mut ts = targets.clone();
                                ts.sort_by_key(|&(p, r)| {
                                    std::cmp::Reverse(data.perks[p].ranks[r - 1].cost)
                                });
                                row.top_result_key = ts
                                    .iter()
                                    .map(|&(p, r)| {
                                        if data.perks[p].ranks.len() > 1 {
                                            format!("{} {}", data.perks[p].name, r)
                                        } else {
                                            data.perks[p].name.clone()
                                        }
                                    })
                                    .collect::<Vec<_>>()
                                    .join(",");
                            } else {
                                row.top_result_key = e.label(&row);
                            }
                            row.materials.resize(slots, String::new());
                            Some(row)
                        })
                        .collect::<Vec<_>>()
                })
                .collect();
            response.rows.append(&mut rows);
        }
    }
    response.cancelled = cancel.load(Ordering::Relaxed);
    response.search_ms = started.elapsed().as_secs_f64() * 1000.;
    Ok(response)
}
