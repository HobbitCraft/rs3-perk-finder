// <nowiki>
// Web Worker for the perk finder reverse search. Spawned from
// Gadget-perkfinder-core.js (main thread) and runs the entire enumeration +
// findPeak + permutation hybrid off-thread so the browser tab stays
// responsive during long-running searches.
//
// Streams results back via postMessage as they're computed; the main thread
// appends each row to the table live.

// === Cheap per-combo score used to order evaluation ===
// score = expected contribution (base + mean roll) summed over slots, per
// target perk, divided by an attempt-cost heuristic (when material prices
// are available).
// The cost-divisor pulls cheaper combos to the top of the heap, which is
// what the user usually wants to see. Purely an ordering heuristic; actual
// probability + cost are computed downstream.
//
// matContribToTarget: the hot inner loop, called once per (combo slot, target)
// inside comboScore. Across a large search (e.g. 10 M combos × 9 slots × 2
// targets × 6 configs) the unique key space is only ~80 materials × 2 targets
// × 3 gizmo types × 2 ancient modes ≈ 960 distinct results, so a module-level
// memoization cache turns ~1 B calls into ~960 actual computations.
var matContribCache = Object.create(null);

function matContribToTarget(mat, targetName, gizmoType, ancient) {
	if (!mat) return 0;
	var key = mat + '\x00' + targetName + '\x00' + gizmoType + '\x00' + (ancient ? 'A' : 'R');
	var cached = matContribCache[key];
	if (cached !== undefined) return cached;
	var data = self.rsPerks.comps[mat];
	if (!data) {
		matContribCache[key] = 0;
		return 0;
	}
	var list = data[gizmoType] || [];
	var score = 0;
	for (var i = 0; i < list.length; i++) {
		if (list[i].perk === targetName) {
			var base = list[i].base, roll = list[i].roll;
			if (ancient && data.ancient !== true) {
				base = Math.floor(base * 0.8);
				roll = Math.floor(roll * 0.8);
			}
			score += base + roll / 2;
		}
	}
	matContribCache[key] = score;
	return score;
}


var COMBO_SCORE_SCALE = 60;

function comboScore(combo, gizmoType, ancient, targets) {
	var jointProb = 1.0;
	for (var ti = 0; ti < targets.length; ti++) {
		var target = targets[ti];
		var perkData = self.rsPerks.perks[target.name];
		if (!perkData || !perkData.ranks) return 0;
		var rank = target.minRank || 1;
		if (rank > perkData.ranks.length) return 0;
		var rankData = perkData.ranks[rank - 1];
		// Ancient-only ranks can't be produced by regular gizmos.
		if (rankData.ancientOnly === 1 && !ancient) return 0;

		var threshold = rankData.threshold;

		// Sum of (base + roll/2) per slot for this target, aka the
		// expected material-roll contribution.
		var s = 0;
		var name = target.name;
		for (var i = 0; i < combo.length; i++) {
			s += matContribToTarget(combo[i], name, gizmoType, ancient);
		}

		// Linear-clamp sigmoid centred at the threshold: p = 0.5 when
		// s = threshold, p = 0 at s = threshold - SCALE/2 (and below),
		// p = 1 at s = threshold + SCALE/2 (and above).
		var p = (s - threshold + COMBO_SCORE_SCALE / 2) / COMBO_SCORE_SCALE;
		if (p <= 0) return 0;
		if (p > 1) p = 1;
		jointProb *= p;
	}
	if (jointProb <= 0) return 0;

	// === Material-cost heuristic ===
	// Read prices off rsPerkCalc directly. Main thread refreshes them
	// on every search. If empty, fall back to pure jointProb so ordering
	// still works. Shell cost is excluded on purpose.
	var matPrices = self.rsPerkCalc.materialPrices;
	var cost = 0;
	if (matPrices) {
		for (var ci = 0; ci < combo.length; ci++) {
			var price = matPrices[combo[ci]];
			if (price) cost += price;
		}
	}
	if (cost <= 0) return jointProb;

	// score = probability proxy per gp of material cost. Sorting
	// descending puts probability-dense combos at the top of the
	// heap; cross-gizmo comparison is unbiased because shell cost
	// has been factored out.
	return jointProb / cost;
}

// === Message handling ===
var initialized = false;
var cancelled = false;
var searching = false;
var searchSession = null;

self.onmessage = function (e) {
	var msg = e.data || {};
	if (msg.type === 'init') {
		if (initialized) { self.postMessage({ type: 'ready' }); return; }
		try {
			self.rsPerks = msg.sources.data;
			self.rsPerkCalc = rsPerkCalc;
			self.rsPerkCalc.data = self.rsPerks;
			self.PerkFinderSearch = PerkFinderSearch();

			if (!self.rsPerks) throw new Error('rsPerks not loaded after evaluating perkcalc-data');
			if (!self.rsPerkCalc || typeof self.rsPerkCalc.getMaterialsProb !== 'function') {
				throw new Error('rsPerkCalc.getMaterialsProb not exposed -- the perkcalc-core patch is not live');
			}
			if (!self.PerkFinderSearch) throw new Error('PerkFinderSearch not loaded after evaluating perkfinder-search');
			initialized = true;
			self.postMessage({ type: 'ready' });
		} catch (err) {
			self.postMessage({ type: 'error', message: 'Init failed: ' + (err && err.message ? err.message : String(err)) });
		}
	} else if (msg.type === 'search') {
		if (!initialized) {
			self.postMessage({ type: 'error', message: 'Worker not initialized. Send {type: "init", dataUrl, coreUrl, searchUrl} first.' });
			return;
		}
		if (searching) {
			self.postMessage({ type: 'error', message: 'Already searching.' });
			return;
		}
		if (msg.params && msg.params.prices) {
			self.rsPerkCalc.materialPrices = msg.params.prices.materialPrices || {};
			self.rsPerkCalc.gizmoPrices = msg.params.prices.gizmoPrices || {};
		}
		cancelled = false;
		searching = true;
		searchSession = null;
		runSearch(msg.params);
		// Don't unconditionally reset `searching` here. runSearch may
		// have returned a session whose tail is paused, in which case we
		// stay in the "searching" state until continueTailBatch finishes
		// the last batch or a cancel arrives.
	} else if (msg.type === 'continue-tail') {
		if (!searchSession) {
			self.postMessage({ type: 'error', message: 'No paused search to continue.' });
			return;
		}
		cancelled = false;
		continueTailBatch();
	} else if (msg.type === 'cancel') {
		cancelled = true;
	}
};

function runSearch(params) {
	try {
		self.postMessage({ type: 'started', timestamp: Date.now() });
		var session = self.PerkFinderSearch.search({
			rsPerks: self.rsPerks,
			prob: {
				getMaterialsProb: self.rsPerkCalc.getMaterialsProb,
				getPerkRankProbabilities: self.rsPerkCalc.getPerkRankProbabilities,
				getBudgetDistribution: self.rsPerkCalc.getBudgetDistribution,
				combineGizmoProb: self.rsPerkCalc.combineGizmoProb
			},
			targets: params.targets,
			gizmoTypes: params.gizmoTypes,
			ancientModes: params.ancientModes,
			invLevel: params.invLevel,
			maxDistinctMats: params.maxDistinctMats,
			blacklist: params.blacklist,
			blacklistEmpty: params.blacklistEmpty,
			tailInitialBufferSize: params.tailInitialBufferSize || 10000,
			tailBatchSize: params.tailBatchSize || 10000,
			scoreFn: true,
			materialPrices: self.rsPerkCalc.materialPrices,
			gizmoPrices: self.rsPerkCalc.gizmoPrices,
			onResult: function (row) {
				self.postMessage({ type: 'result', row: row });
			},
			onProgress: function (data) {
				self.postMessage({ type: 'progress', data: data });
			},
			onSubprogress: function (data) {
				self.postMessage({ type: 'subprogress', data: data });
			},
			shouldCancel: function () { return cancelled; }
		});
		// The scoreFn path returns a session object with continueTail();
		// the non-scoreFn path (smoke tests) returns the raw array.
		if (session && typeof session === 'object' && typeof session.continueTail === 'function') {
			if (cancelled) {
				searchSession = null;
				searching = false;
				self.postMessage({ type: 'cancelled', timestamp: Date.now() });
			} else if (session.tailDone) {
				searchSession = null;
				searching = false;
				self.postMessage({ type: 'done', timestamp: Date.now() });
			} else {
				searchSession = session;
				// Stay in `searching` state so a new 'search' message
				// can't race the continue-tail flow. The main thread
				// keeps the submit button disabled until 'done' /
				// 'cancelled' / 'error' fires.
				self.postMessage({ type: 'tail-paused', timestamp: Date.now() });
			}
		} else {
			searchSession = null;
			searching = false;
			self.postMessage({ type: cancelled ? 'cancelled' : 'done', timestamp: Date.now() });
		}
	} catch (err) {
		searchSession = null;
		searching = false;
		self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
	}
}

function continueTailBatch() {
	try {
		var done = searchSession.continueTail();
		if (cancelled) {
			searchSession = null;
			searching = false;
			self.postMessage({ type: 'cancelled', timestamp: Date.now() });
		} else if (done) {
			searchSession = null;
			searching = false;
			self.postMessage({ type: 'done', timestamp: Date.now() });
		} else {
			self.postMessage({ type: 'tail-paused', timestamp: Date.now() });
		}
	} catch (err) {
		searchSession = null;
		searching = false;
		self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
	}
}

//Adapted from [[MediaWiki:Gadget-perkcalc-core.js]]
var rsPerkCalc = {
	rollDice: function (dice, base) {
		var probabilities = [1.0]
		for (var i=0; i < dice.length; i++) {
			var newSize = probabilities.length + dice[i] - 1
			var newArr = []
			for (var i2=0; i2 < newSize; i2++) {
				newArr.push(0.0)
			}
			var total = 0
			for (var i3=0; i3 < newSize; i3++) {
				if (i3 < probabilities.length) {
					total += probabilities[i3]
				}
				if ((i3 - dice[i]) >= 0) {
					total -= probabilities[i3-dice[i]]
				}
				newArr[i3] = (total * 1.0) / dice[i]
			}
			probabilities = newArr
		}
		var baseProbs = []
		for (var i4=0; i4 < base; i4++) {
			baseProbs.push(0.0)
		}
		return baseProbs.concat(probabilities)
	},
	
	/**
	 * Roughly equivalent to Jagex's internal array sort algorithm
	 * which is really god damn weird because it's like quicksort but not.
	 * Sorts in place.
	 * 
	 * Example usage:
	 *     var perkArr = [
	 *       {'perk': 'Cautious', 'cost': 0, 'probability': 0.0019369834710743802, 'rank': 0},
	 *       {'perk': 'Blunted', 'cost': 0, 'probability': 0.00021947873799725651, 'rank': 0},
	 *       {'perk': 'Eruptive', 'cost': 0, 'probability': 0.11297548487631127, 'rank': 0},
	 *       {'perk': 'Precise', 'cost': 65, 'probability': 0.00510406494140625, 'rank': 2},
	 *       {'perk': 'Flanking', 'cost': 0, 'probability': 0.013885498046875, 'rank': 0}
	 *     ]
	 *     quicksort(0, (perkArr.length - 1), perkArr, function (x, y) { return x.cost - y.cost })
	 **/
	quicksort: function (low, high, arr, compare) {
		var pivot_index = (~~((low + high)/2)); // floor division
		var pivot_value = arr[pivot_index]
		arr[pivot_index] = arr[high]
		arr[high] = pivot_value
		var counter = low
		var loop_index = low
	
		while (loop_index < high) {
			if (compare(arr[loop_index], pivot_value) < (loop_index & 1)) {
				var tmp = arr[loop_index]
				arr[loop_index] = arr[counter]
				arr[counter] = tmp
				counter = counter + 1
			}
			loop_index = loop_index + 1
		}
		
		arr[high] = arr[counter]
		arr[counter] = pivot_value

		if (low < (counter - 1)) {
			rsPerkCalc.quicksort(low, counter - 1, arr, compare)
		}
		if ((counter + 1) < high) {
			rsPerkCalc.quicksort(counter + 1, high, arr, compare)
		}
	},
	
	/**
	 * Roughly equivalent to Python's zip function
	 **/
	zip: function (arrays) {
		return arrays[0].map(function(_,i){
			return arrays.map(function(array){return array[i]})
		});
	},
	
	/**
	 * Roughly equivalent to Python's itertools.product function
	 **/
	product: function () {
		var args = Array.prototype.slice.call(arguments); // makes array from arguments
		return args.reduce(function tl (accumulator, value) {
		var tmp = [];
		for (var i=0; i < accumulator.length; i++) {
			for (var i2=0; i2 < value.length; i2++) {
				tmp.push(accumulator[i].concat(value[i2]));
			}
		}
		return tmp;
		}, [[]]);
	},
	
	_product: function (arr) {
		var p = 1.0
		for (var i=0; i < arr.length; i++) {
			p *= arr[i]
		}
		return p
	},
	
	/**
	 * Generate the perk probabilities
	 **/
	getPerkRankProbabilities: function (gizmoType, matsUsed, ancient) {
		var bases = {},
			dices = {},
			order = [];
		
		// console.log('Running getMaterialsProb')
		
		for (var i=0; i < matsUsed.length; i++) {
			var mat = matsUsed[i]
			if (rsPerkCalc.data.comps[mat] === undefined) {
				continue
			}

			for (var i2=0; i2 < rsPerkCalc.data.comps[mat][gizmoType].length; i2++) {
				if (order.length >= 20) {
					continue
				}
				var _data = rsPerkCalc.data.comps[mat],
					perk = _data[gizmoType][i2],
					name = perk.perk
				
				var perkBase = perk['base'],
					perkRoll = perk['roll']
				
				if (ancient && _data.ancient !== true) {
					// this slot is an ancient gizmo slot with a regular mat
					perkBase = Math.floor(perk['base'] * 0.8)
					perkRoll = Math.floor(perk['roll'] * 0.8)
				}
				
				if (!bases.hasOwnProperty(name)) {
					order.push(name)
					bases[name] = perkBase
					dices[name] = [perkRoll]
				} else {
					bases[name] += perkBase
					dices[name].push(perkRoll)
				}
			}
		}
		if (order.length === 0) {
			return { 'err': "No materials provided (or the materials selected provide no perks in this gizmo), click/tap/drag the materials above to add some" }
		}
		
		// console.log(bases, dices, order)
		
		var probabilities = []
		for (var i3=0; i3 < order.length; i3++) {
			var perk = order[i3]
			var distribution = rsPerkCalc.rollDice(dices[perk], bases[perk])
			
			var ranks = [0]
			for (var i4=0; i4 < rsPerkCalc.data.perks[perk]['ranks'].length; i4++) { 
				if (!ancient && rsPerkCalc.data.perks[perk]['ranks'][i4]['ancientOnly'] == 1) {
					continue;
				}
				ranks.push(rsPerkCalc.data.perks[perk]['ranks'][i4]['threshold'])
			}
			ranks.push(9999)
			
			var rank = 0
			var probs = []
			
			var zipRanks = rsPerkCalc.zip([ranks.slice(0, -1), ranks.slice(1)])
			// console.log(zipRanks)
			for (var i5=0; i5 < zipRanks.length; i5++) {
				var low = zipRanks[i5][0],
					high = zipRanks[i5][1]
					
				// console.log(low, high)
				
				var probability = distribution.slice(low, high)
				
				// console.log(probability)
				probability = probability.reduce(function(a,b){
					return a + b
				}, 0)
				if (probability > 0) {
					if (rank > 0) {
						probs.push({'rank': rank, 'probability': probability, 'cost': rsPerkCalc.data.perks[perk]['ranks'][rank-1]['cost'], 'perk': perk})
					} else {
						probs.push({'rank': rank, 'probability': probability, 'cost': 0, 'perk': perk})
					}
				}
				rank += 1
			}
			probabilities.push(probs)
		}
		
		// console.log('probs ', JSON.stringify(probabilities))
		return probabilities
	},
	
	getBudgetDistribution: function (invLevel, ancient) {
		var toRoll = []
		for (var i6=0; i6 < (ancient ? 6 : 5); i6++) { // 5 rolls, 6 for ancient
			toRoll.push(20 + (~~(invLevel/2))); // floor division
		}
		var contribution = rsPerkCalc.rollDice(toRoll, 0)
		contribution[invLevel] += contribution.slice(0, invLevel).reduce(function(a,b){
			return a + b
		}, 0)
		
		for (var i7=0; i7 < invLevel; i7++) {
			contribution[i7] = 0.0
		}
		
		// console.log('contribution ', contribution)
		return contribution
	},
	
	combineGizmoProb: function (probabilities, contribution, invLevel) {
		var final = {}
		var combos = rsPerkCalc.product.apply(null, probabilities)
		
		// console.log('combos ', combos)
		var cache = {};
		for (var i8=0; i8 < combos.length; i8++) {
			var combo = combos[i8],
				comboProbs = []
			
			for (var i9=0; i9 < combo.length; i9++) {
				comboProbs.push(combo[i9]['probability'])
			}
			
			var combo_probability = rsPerkCalc._product(comboProbs)
			rsPerkCalc.quicksort(0, (combo.length - 1), combo, function (x, y) { return x.cost - y.cost })
			var cache_key = [];
			for (var iterthing = 0; iterthing < combo.length; iterthing++) {
				cache_key.push(combo[iterthing].cost)
			}
			var inner_probs = cache[cache_key]
			if (inner_probs === undefined) {
				inner_probs = {};
				var lowest_contribution = Math.floor((invLevel-1) / 5) * 5 + 1;
				var highest_contribution = contribution.length - 1;
				for (var candidate_contribution_iter = lowest_contribution; candidate_contribution_iter <= highest_contribution; candidate_contribution_iter += 5) {
					var candidate_contribution = candidate_contribution_iter
					var contribution_probability = contribution.slice(candidate_contribution, (candidate_contribution + 5)).reduce(function(a,b){
						return a + b
					}, 0)
					var perk_indexes = []
					for (var i11=combo.length - 1; i11 >= 0; i11--) {
						var perk = combo[i11]
						if (perk['cost'] == 0) {
							continue
						}
						if (candidate_contribution > perk['cost']) {
							perk_indexes.push(i11)
							candidate_contribution -= perk['cost']
						}
						if (perk_indexes.length == 2) {
							break
						}
					}
					
					if (inner_probs[perk_indexes] === undefined) {
						inner_probs[perk_indexes] = 0.0;
					}
					inner_probs[perk_indexes] += contribution_probability
				}

				var tmp_entries = Object.entries(inner_probs);
				var inner_probs = [];
				for (var iterthing2 = 0; iterthing2 < tmp_entries.length; iterthing2++) {
					var perk_indexes_str = tmp_entries[iterthing2][0];
					var perk_indexes = [];
					var p = tmp_entries[iterthing2][1];
					if (perk_indexes_str !== "") {
						var split = perk_indexes_str.split(",");
						for (var iterthing3 = 0; iterthing3 < split.length; iterthing3++) {
							perk_indexes.push(parseInt(split[iterthing3]));
						}
					}
					inner_probs.push([perk_indexes, p])
				}
				cache[cache_key] = inner_probs;
			}
			for (var iterthing4 = 0; iterthing4 < inner_probs.length; iterthing4++) {
				var perk_indexes = inner_probs[iterthing4][0];
				var p = inner_probs[iterthing4][1];
				var perks_used = [];
				var hasdouble = false;
				for (var iterthing5 = 0; iterthing5 < perk_indexes.length; iterthing5++) {
					var perk = combo[perk_indexes[iterthing5]];
					var perkstr = perk.perk;
					hasdouble = hasdouble || (rsPerkCalc.data.perks[perk.perk].doubleslot === true);
					if (rsPerkCalc.data.perks[perk.perk].ranks.length > 1) {
						perkstr += ' '+perk.rank
					}
					perks_used.push(perkstr);
				}
				if (hasdouble) {
					perks_used = perks_used.slice(0, 1);
				}
				
				if (final[perks_used] === undefined) {
					final[perks_used] = 0.0;
				}
				final[perks_used] += combo_probability * p;
			}
		}
		
		// console.log('final ', final)
		
		return final
	},
	
	getMaterialsProb: function (invLevel, gizmoType, matsUsed, ancient) {
		var probabilities = rsPerkCalc.getPerkRankProbabilities(gizmoType, matsUsed, ancient)
		if (!Array.isArray(probabilities)) {
			return probabilities;    // for { 'err': "No materials provided (or the materials selected provide no perks in this gizmo), click/tap/drag the materials above to add some" }
		}
		var contribution = rsPerkCalc.getBudgetDistribution(invLevel, ancient)
		return rsPerkCalc.combineGizmoProb(probabilities, contribution, invLevel)
	}

}

// Inverse search for the Invention perk calculator. Given target perks +
// constraints, enumerates material combinations that can produce them.
// Does NOT include the probability algorithm
//
// Strategy:
//   1. For each gizmo, filter materials down to
//      those that can contribute to any target perk in that gizmo type.
//   2. Enumerate multiset combinations of N slots (5 or 9) from the candidate
//      pool, capped at maxDistinctMats distinct values per combo by default.
//   3. Prune combos that lack a contributor for at least one target perk.
//   4. Score with getMaterialsProb, walk result keys, match against the target
//      perk + minRank requirements.
//   5. Emit rows.

function PerkFinderSearch() {

	// === Combo scoring ===
	// Per-target contribution sums are mapped through a clamped-linear
	// sigmoid centred at the rank threshold: p = 0 at (threshold -
	// SCALE/2), 0.5 at threshold, 1 at (threshold + SCALE/2). The
	// per-target probability proxies are multiplied for the joint, then
	// divided by material cost (gizmo shell excluded)
	//
	// 60 is a compromise: tighter (~5-10) would track low-roll materials
	// better but would misjudge high-roll materials.
	var COMBO_SCORE_SCALE = 60;

	// Perk blacklist for (ANY) searches.
	// null = no blacklist
	var activeBlacklist = null;
	// For blacklisting (EMPTY).
	var activeBlacklistEmpty = false;

	var SCORE_EPS = 1e-4;
	function rankReachProb(meanSum, varSum, threshold) {
		if (varSum <= 1e-9) return meanSum >= threshold ? 1 : 0;
		var z = (meanSum - threshold) / Math.sqrt(varSum);
		return 1 / (1 + Math.exp(-1.702 * z));
	}

	function parseResultKey(key) {
		if (key === '') return [];
		return key.split(',').map(function (s) {
			var m = s.match(/^(.+?)(?: (\d+))?$/);
			return { name: m[1], rank: m[2] ? parseInt(m[2], 10) : null };
		});
	}

	// By default, extra perks beyond the targets are allowed (e.g. searching
	// for "Precise 3" also matches "Precise 3, Equilibrium 1"). 
	// Except when the user picks "(EMPTY)" for perk2.
	function keyMatches(parsedKey, targets) {
		if (targets.exactCount) {
			if (parsedKey.length !== targets.length) return false;
		} else {
			if (parsedKey.length < targets.length) return false;
		}
		var used = {};
		for (var t = 0; t < targets.length; t++) {
			var target = targets[t];
			var hit = -1;
			for (var i = 0; i < parsedKey.length; i++) {
				if (used[i]) continue;
				var p = parsedKey[i];
				if (p.name !== target.name) continue;
				var rank = p.rank != null ? p.rank : 1;
				if (rank < target.minRank) continue;
				hit = i;
				break;
			}
			if (hit < 0) return false;
			used[hit] = true;
		}
		return true;
	}

	function enumerateCombos(items, k, maxDistinct, visitor, shouldCancel) {
		var n = items.length;
		var combo = new Array(k);
		var stopped = false;

		function recurse(pos, startIdx, distinct) {
			if (stopped) return;
			if (shouldCancel && shouldCancel()) { stopped = true; return; }
			if (pos === k) {
				if (visitor(combo) === false) stopped = true;
				return;
			}
			for (var i = startIdx; i < n; i++) {
				var isEmpty = items[i] === '';
				var sameAsPrev = (i === startIdx && pos > 0);
				var newDistinct = (isEmpty || sameAsPrev) ? distinct : distinct + 1;
				if (maxDistinct != null && newDistinct > maxDistinct) continue;
				combo[pos] = items[i];
				recurse(pos + 1, i, newDistinct);
				if (stopped) return;
			}
		}
		recurse(0, 0, 0);
	}

	function comboCoversRequired(combo, requiredSets) {
		for (var r = 0; r < requiredSets.length; r++) {
			var set = requiredSets[r];
			var hit = false;
			for (var i = 0; i < combo.length; i++) {
				if (set[combo[i]]) { hit = true; break; }
			}
			if (!hit) return false;
		}
		return true;
	}

	// Iterative resumable variant of enumerateCombos.
	// Exists so the scoreFn search path can round-robin
	// enumerations across all (gizmoType, ancient) configs,
	// instead of nested for-loop starting from weapon-regular.
	// Allows results of all variants to populate output early.
	// stack is parallel Int32Arrays rather than array of plain
	// objects. Object-stack was slower for big searches because
	// each leaf combo allocated k+1 objects and V8's GC pressure
	// dominated.
	function createMultisetEnumerator(items, k, maxDistinct) {
		var n = items.length;
		if (n === 0 || k === 0) {
			return { next: function () { return null; } };
		}
		var combo = new Array(k);
		// Parallel int32 stacks; max depth k+1
		var startIdxArr = new Int32Array(k + 1);
		var distinctArr = new Int32Array(k + 1);
		var iArr = new Int32Array(k + 1);

		var depth = 1;
		// null sentinel for "no cap" mapped to a max-int constant
		var maxD = maxDistinct == null ? 0x7FFFFFFF : maxDistinct | 0;

		function advance() {
			while (depth > 0) {
				var top = depth - 1;
				if (top === k) {
					depth = top;
					return true;
				}
				var i = iArr[top];
				if (i >= n) {
					depth = top;
					continue;
				}
				iArr[top] = i + 1;
				var startIdx = startIdxArr[top];
				var isEmpty = items[i] === '';
				var sameAsPrev = (i === startIdx && top > 0);
				var dist = distinctArr[top];
				var newDistinct = (isEmpty || sameAsPrev) ? dist : dist + 1;
				if (newDistinct > maxD) continue;
				combo[top] = items[i];
				// Push new frame at index `depth`.
				startIdxArr[depth] = i;
				distinctArr[depth] = newDistinct;
				iArr[depth] = i;
				depth++;
			}
			return false;
		}

		return {
			next: function () {
				if (advance()) return combo;
				return null;
			}
		};
	}

	// Iterative, indexed, multiset enumerator.
	function createBoundedEnumerator(cfg, maxDistinct) {
		var nMats = cfg.nMats;
		var slots = cfg.slots;
		if (nMats === 0 || slots === 0) {
			return { next: function () { return null; } };
		}
		var combo = new Int32Array(slots);
		// Stack: max depth = slots + 1 (root + leaf).
		var startIdxArr = new Int32Array(slots + 1);
		var distinctArr = new Int32Array(slots + 1);
		var iArr = new Int32Array(slots + 1);
		var coveredArr = new Int32Array(slots + 1);
		var nTargets = cfg.nTargets;
		var contribSumMaxArrs = new Array(nTargets);
		for (var t0 = 0; t0 < nTargets; t0++) {
			contribSumMaxArrs[t0] = new Float64Array(slots + 1);
		}
		// Hot-loop locals cached out of cfg to avoid repeated property reads.
		var itemMask = cfg.itemMask;
		var contribAvail = cfg.contribAvail;
		var allCoveredMask = cfg.allCoveredMask;
		var contribTableMax = cfg.contribTableMax;
		var maxContribMaxRemaining = cfg.maxContribMaxRemaining;
		var thresholds = cfg.thresholds;
		var emptyIdx = cfg.emptyIdx;
		var depth = 1;
		var maxD = maxDistinct == null ? 0x7FFFFFFF : maxDistinct | 0;

		function advance() {
			while (depth > 0) {
				var top = depth - 1;
				if (top === slots) {
					depth = top;
					return true;
				}
				var i = iArr[top];
				if (i >= nMats) { depth = top; continue; }
				iArr[top] = i + 1;
				var startIdx = startIdxArr[top];
				var isEmpty = (i === emptyIdx);
				var sameAsPrev = (i === startIdx && top > 0);
				var dist = distinctArr[top];
				var newDistinct = (isEmpty || sameAsPrev) ? dist : dist + 1;
				if (newDistinct > maxD) continue;

				// === Coverage bound ===
				var newCovered = coveredArr[top] | itemMask[i];
				var uncovered = allCoveredMask & ~newCovered;
				if ((uncovered & contribAvail[i]) !== uncovered) continue;

				// === Score bound (MAX-based, per target) ===
				// If even max-best-completion can't clear the
				// threshold, no dice roll on any leaf can fire the
				// rank, so prune.
				var remaining = slots - top - 1;
				var prune = false;
				for (var t = 0; t < nTargets; t++) {
					var newSumMax = contribSumMaxArrs[t][top] + contribTableMax[t][i];
					var maxFinal = newSumMax + remaining * maxContribMaxRemaining[t][i];
					if (maxFinal < thresholds[t]) { prune = true; break; }
				}
				if (prune) continue;

				combo[top] = i;
				startIdxArr[depth] = i;
				distinctArr[depth] = newDistinct;
				iArr[depth] = i;
				coveredArr[depth] = newCovered;
				for (var t2 = 0; t2 < nTargets; t2++) {
					contribSumMaxArrs[t2][depth] = contribSumMaxArrs[t2][top] + contribTableMax[t2][i];
				}
				depth++;
			}
			return false;
		}

		return {
			next: function () {
				if (advance()) return combo;
				return null;
			}
		};
	}

	// Enumerate multisets like enumerateCombos, but additionally prune any
	// sub-tree whose remaining items can't possibly cover every required target.
	function enumerateCombosCoverageBound(items, k, maxDistinct, contribSets, visitor, shouldCancel) {
		var n = items.length;
		var nTargets = contribSets.length;
		var combo = new Array(k);
		var stopped = false;

		// Pre-compute per-item bitmask instead of re-scanning every contribSet.
		var itemMask = new Array(n);
		for (var ii = 0; ii < n; ii++) {
			var m = 0;
			for (var ti = 0; ti < nTargets; ti++) {
				if (contribSets[ti][items[ii]]) m |= (1 << ti);
			}
			itemMask[ii] = m;
		}

		var contribAvail = new Array(n + 1);
		contribAvail[n] = 0;
		for (var i = n - 1; i >= 0; i--) {
			contribAvail[i] = contribAvail[i + 1] | itemMask[i];
		}
		var allCoveredMask = (1 << nTargets) - 1;

		function recurse(pos, startIdx, distinct, coveredMask) {
			if (stopped) return;
			if (shouldCancel && shouldCancel()) { stopped = true; return; }

			// Coverage bound: every still-uncovered target must have at
			// least one contributor in items[startIdx..n-1]. If not, no
			// completion of this partial combo can satisfy the search;
			// drop the whole sub-tree.
			var uncovered = allCoveredMask & ~coveredMask;
			if ((uncovered & contribAvail[startIdx]) !== uncovered) return;

			if (pos === k) {
				if (coveredMask === allCoveredMask) {
					if (visitor(combo) === false) stopped = true;
				}
				return;
			}

			for (var i = startIdx; i < n; i++) {
				var item = items[i];
				var isEmpty = item === '';
				var sameAsPrev = (i === startIdx && pos > 0);
				var newDistinct = (isEmpty || sameAsPrev) ? distinct : distinct + 1;
				if (maxDistinct != null && newDistinct > maxDistinct) continue;
				combo[pos] = item;
				recurse(pos + 1, i, newDistinct, coveredMask | itemMask[i]);
				if (stopped) return;
			}
		}
		recurse(0, 0, 0, 0);
	}

	// === Combinatorial count of candidate combos per config. ===
	// Returns the exact number of multisets enumerateCombos will visit
	// for a given (slots, poolSize, maxDistinct) tuple, so the UI can
	// show a "X / Y candidates" total right from the start.
	//
	// formula:
	//   count(L, R, K)  =  Σ_{D=1..min(L, K, R)}  C(R, D) · C(L-1, D-1)
	// then sum over E from 0 to slots.
	function binomial(n, k) {
		if (k < 0 || k > n) return 0;
		if (k === 0 || k === n) return 1;
		if (k > n - k) k = n - k;
		var result = 1;
		for (var i = 0; i < k; i++) {
			result = result * (n - i) / (i + 1);
		}
		return result;
	}

	function countCandidateCombos(slots, poolSize, maxDistinct) {
		if (slots === 0) return 1;
		if (poolSize === 0) return 0;
		var realCount = poolSize - 1; // pool[0] is the empty sentinel
		var total = 0;
		for (var E = 0; E <= slots; E++) {
			var L = slots - E;
			if (L === 0) { total += 1; continue; }
			var maxD = Math.min(L, maxDistinct, realCount);
			for (var D = 1; D <= maxD; D++) {
				total += binomial(realCount, D) * binomial(L - 1, D - 1);
			}
		}
		return total;
	}

	// Count the unique perks producible by this combo on the given gizmo type.
	// Used to detect when the order of materials affects the calculator's output.
	// Once order.length >= 20, further perk entries are silently dropped, so
	// material order changes which perks survive into the calculation.
	// Any combo with >1 distinct material is potentially order-sensitive,
	// regardless of whether the 20-cap is hit.
	function comboUniquePerksCount(combo, gizmoType, rsPerks) {
		var unique = Object.create(null);
		for (var i = 0; i < combo.length; i++) {
			var mat = combo[i];
			if (!mat) continue;
			var matData = rsPerks.comps[mat];
			if (!matData) continue;
			var perkList = matData[gizmoType] || [];
			for (var p = 0; p < perkList.length; p++) {
				unique[perkList[p].perk] = true;
			}
		}
		var count = 0;
		for (var k in unique) count++;
		return count;
	}

	// Count distinct non-empty materials in a combo.
	function comboDistinctMatsCount(combo) {
		var seen = Object.create(null);
		var count = 0;
		for (var i = 0; i < combo.length; i++) {
			var mat = combo[i];
			if (!mat) continue;
			if (!seen[mat]) {
				seen[mat] = true;
				count++;
			}
		}
		return count;
	}

	// Can material order change the combo's probability for the targets?
	// Returns true if order might matter.
	// we only care about ties that can change whether a TARGET perk lands
	// in the generated set.
	function comboOrderSensitive(combo, gizmoType, targets, rsPerks) {
		// targetCostOwners: cost value -> { targetPerkName: true } for every
		// cost a target can take at a rank >= its minRank.
		var targetCostOwners = Object.create(null);
		var anyTargetCost = false;
		for (var t = 0; t < targets.length; t++) {
			var tname = targets[t].name;
			var minRank = targets[t].minRank || 1;
			var tdata = rsPerks.perks[tname];
			if (!tdata || !tdata.ranks) continue;
			// ranks[] is 0-indexed; ranks[i] is rank i+1. Qualifying ranks
			// are minRank..maxRank => indices (minRank-1)..(len-1).
			for (var ri = minRank - 1; ri < tdata.ranks.length; ri++) {
				if (ri < 0) continue;
				var tcost = tdata.ranks[ri].cost;
				if (!tcost) continue;
				var owners = targetCostOwners[tcost];
				if (owners === undefined) { owners = Object.create(null); targetCostOwners[tcost] = owners; }
				owners[tname] = true;
				anyTargetCost = true;
			}
		}
		if (!anyTargetCost) return false;
		var perksSeen = Object.create(null);
		for (var i = 0; i < combo.length; i++) {
			var mat = combo[i];
			if (!mat) continue;
			var matData = rsPerks.comps[mat];
			if (!matData) continue;
			var perkList = matData[gizmoType] || [];
			for (var p = 0; p < perkList.length; p++) {
				var qname = perkList[p].perk;
				if (perksSeen[qname]) continue; // process each perk's ranks once
				perksSeen[qname] = true;
				var qdata = rsPerks.perks[qname];
				if (!qdata || !qdata.ranks) continue;
				for (var qr = 0; qr < qdata.ranks.length; qr++) {
					var qcost = qdata.ranks[qr].cost;
					if (!qcost) continue;
					var owners2 = targetCostOwners[qcost];
					if (owners2 !== undefined) {
						for (var ownerName in owners2) {
							if (ownerName !== qname) return true;
						}
					}
				}
			}
		}
		return false;
	}

	// Decides whether a 2-target search needs filler materials in its pool.
	// A filler can only add a match by reordering the perks
	function targetsCanTie(gizmoType, targets, rsPerks, contributorMats) {
		var targetCostSet = Object.create(null);
		var targetNames = Object.create(null);
		var anyCost = false;
		for (var t = 0; t < targets.length; t++) {
			var tname = targets[t].name;
			targetNames[tname] = true;
			var minRank = targets[t].minRank || 1;
			var tdata = rsPerks.perks[tname];
			if (!tdata || !tdata.ranks) continue;
			for (var ri = minRank - 1; ri < tdata.ranks.length; ri++) {
				if (ri < 0) continue;
				var tcost = tdata.ranks[ri].cost;
				if (tcost) { targetCostSet[tcost] = true; anyCost = true; }
			}
		}
		if (!anyCost) return false;
		var perksSeen = Object.create(null);
		// contributorMats is the restricted matsArr (array of contributor
		// names + the '' sentinel).
		for (var mi = 0; mi < contributorMats.length; mi++) {
			var mat = contributorMats[mi];
			if (mat === '') continue;
			var matData = rsPerks.comps[mat];
			if (!matData) continue;
			var list = matData[gizmoType];
			if (!list) continue;
			for (var i = 0; i < list.length; i++) {
				var qname = list[i].perk;
				if (targetNames[qname]) continue; // non-target perks only
				if (perksSeen[qname]) continue;
				perksSeen[qname] = true;
				var qdata = rsPerks.perks[qname];
				if (!qdata || !qdata.ranks) continue;
				for (var qr = 0; qr < qdata.ranks.length; qr++) {
					var qcost = qdata.ranks[qr].cost;
					if (qcost && targetCostSet[qcost]) return true;
				}
			}
		}
		return false;
	}

	// Score a material by how much it contributes to the target perks vs.
	// non-target perks on the chosen gizmo type. Higher scores rank earlier
	// in the heuristic ordering.
	function heuristicMatScore(mat, gizmoType, targetNames, rsPerks) {
		if (!mat) return -1e9; // empty slots last
		var data = rsPerks.comps[mat];
		if (!data) return -1e9;
		var perkList = data[gizmoType] || [];
		var targetCount = 0, nonTargetCount = 0;
		for (var i = 0; i < perkList.length; i++) {
			if (targetNames[perkList[i].perk]) targetCount++;
			else nonTargetCount++;
		}
		// Makes any material contributing to a target dominate any that doesn't.
		// The -1 per non-target perk tie-breaks toward materials that pollute
		// the order less.
		return targetCount * 100 - nonTargetCount;
	}

	// Return the heuristic ordering plus several "devil's advocate" probe
	// orderings of the same multiset. If findPeak gives the same peak prob
	// across all probes, we can skip exhaustive permutation search with
	// reasonable confidence; otherwise, the disagreement signals genuine
	// order-sensitivity and we fall back to exhaustive search (within a cap).
	function probeOrderings(combo, gizmoType, targets, rsPerks) {
		var targetNames = Object.create(null);
		for (var i = 0; i < targets.length; i++) targetNames[targets[i].name] = true;

		var byScore = combo.slice().sort(function (a, b) {
			return heuristicMatScore(b, gizmoType, targetNames, rsPerks) -
				heuristicMatScore(a, gizmoType, targetNames, rsPerks);
		});
		var byScoreReverse = byScore.slice().reverse();
		var alpha = combo.slice().sort();
		var alphaReverse = alpha.slice().reverse();

		// Rarity-based: sort by occurrence count ascending (singletons first),
		// tie-break by score descending.
		// Targets the case where a low-count material must register its perks
		// before high-count materials flood the priority queue. 
		// e.g.: Timeworn 1, Evasive 4, Manufactured 4
		var counts = Object.create(null);
		for (var ci = 0; ci < combo.length; ci++) counts[combo[ci]] = (counts[combo[ci]] || 0) + 1;
		var byRarity = combo.slice().sort(function (a, b) {
			if (counts[a] !== counts[b]) return counts[a] - counts[b];
			return heuristicMatScore(b, gizmoType, targetNames, rsPerks) -
				heuristicMatScore(a, gizmoType, targetNames, rsPerks);
		});
		var byRarityReverse = byRarity.slice().reverse();

		return {
			heuristic: byScore,
			probes: [byScoreReverse, alpha, alphaReverse, byRarity, byRarityReverse]
		};
	}

	// Minimal binary min-heap keyed by an item's .score field. Used by
	// the scoreFn search path to maintain a top-K set of high-score
	// combos during enumeration so the worker never has to materialize
	// every covering combo just to sort them.
	function MinHeap() {
		this._arr = [];
	}
	MinHeap.prototype.size = function () { return this._arr.length; };
	MinHeap.prototype.peek = function () { return this._arr[0]; };
	MinHeap.prototype.push = function (item) {
		var arr = this._arr;
		arr.push(item);
		var i = arr.length - 1;
		while (i > 0) {
			var parent = (i - 1) >> 1;
			if (arr[i].score < arr[parent].score) {
				var tmp = arr[i];
				arr[i] = arr[parent];
				arr[parent] = tmp;
				i = parent;
			} else break;
		}
	};
	MinHeap.prototype.pop = function () {
		var arr = this._arr;
		if (arr.length === 0) return undefined;
		var top = arr[0];
		var last = arr.pop();
		if (arr.length > 0) {
			arr[0] = last;
			var i = 0;
			var n = arr.length;
			while (true) {
				var left = 2 * i + 1;
				var right = 2 * i + 2;
				var smallest = i;
				if (left < n && arr[left].score < arr[smallest].score) smallest = left;
				if (right < n && arr[right].score < arr[smallest].score) smallest = right;
				if (smallest === i) break;
				var tmp = arr[i];
				arr[i] = arr[smallest];
				arr[smallest] = tmp;
				i = smallest;
			}
		}
		return top;
	};

	MinHeap.prototype.replaceTop = function (item) {
		var arr = this._arr;
		arr[0] = item;
		var i = 0;
		var n = arr.length;
		while (true) {
			var left = 2 * i + 1;
			var right = 2 * i + 2;
			var smallest = i;
			if (left < n && arr[left].score < arr[smallest].score) smallest = left;
			if (right < n && arr[right].score < arr[smallest].score) smallest = right;
			if (smallest === i) break;
			var tmp = arr[i];
			arr[i] = arr[smallest];
			arr[smallest] = tmp;
			i = smallest;
		}
	};

	// Closed-form count of distinct permutations of a multiset (n! divided
	// by the product of count-factorials). Used by evaluateOneCombo to
	// decide whether the exhaustive permutation enumeration is worth
	// attempting before actually building the permutation array.
	function multinomialCount(items) {
		var counts = Object.create(null);
		var n = items.length;
		for (var i = 0; i < n; i++) {
			counts[items[i]] = (counts[items[i]] || 0) + 1;
		}

		var result = 1;
		var sofar = 0;
		for (var key in counts) {
			var c = counts[key];
			sofar += c;
			result *= binomial(sofar, c);
		}
		return Math.round(result);
	}

	// Generate all distinct permutations of a multiset.
	function distinctPermutations(items) {
		var sorted = items.slice().sort();
		var results = [];
		var n = sorted.length;
		var current = sorted.slice();

		function recurse(start) {
			if (start === n) {
				results.push(current.slice());
				return;
			}
			var used = Object.create(null);
			for (var i = start; i < n; i++) {
				if (used[current[i]]) continue;
				used[current[i]] = true;
				var tmp = current[start];
				current[start] = current[i];
				current[i] = tmp;
				recurse(start + 1);
				current[i] = current[start];
				current[start] = tmp;
			}
		}
		recurse(0);
		return results;
	}

	function distinctMaterialPermutations(items, cap) {
		var counts = Object.create(null);
		var distinct = [];
		for (var i = 0; i < items.length; i++) {
			if (counts[items[i]] === undefined) { counts[items[i]] = 0; distinct.push(items[i]); }
			counts[items[i]]++;
		}
		var fact = 1;
		for (var f = 2; f <= distinct.length; f++) fact *= f;
		if (fact > cap) return null;
		var orders = distinctPermutations(distinct);
		var out = [];
		for (var o = 0; o < orders.length; o++) {
			var full = [];
			for (var d = 0; d < orders[o].length; d++) {
				var m = orders[o][d];
				for (var c = 0; c < counts[m]; c++) full.push(m);
			}
			out.push(full);
		}
		return out;
	}

	// Cheap whole-name substring check: does `rk` contain `name` as a
	// complete perk token? Used in evalLevel to skip the expensive
	// regex parse + keyMatches walk for keys that can't possibly satisfy
	// any target.
	function keyContainsPerkName(rk, name) {
		var nameLen = name.length;
		var idx = rk.indexOf(name);
		while (idx >= 0) {
			var atStart = idx === 0 || rk.charCodeAt(idx - 1) === 44; // ','
			if (atStart) {
				var end = idx + nameLen;
				if (end === rk.length) return true;
				var nextChar = rk.charCodeAt(end);
				if (nextChar === 44 || nextChar === 32) return true; // ',' or ' '
			}
			idx = rk.indexOf(name, idx + 1);
		}
		return false;
	}

	// Allocation-free combined parseResultKey + keyMatches.
	// Single pass over the key, tokenising on ',' via charCodeAt and
	// splitting each token on ' ' for the rank suffix.
	// Returns:
	//   - The number of tokens (= perk count) when every target has a
	//     matching token at rank >= minRank, AND (if targets.exactCount
	//     is truthy) tokenCount === targets.length.
	//   - -1 when the key does not satisfy the targets.
	function checkKeyMatchLen(key, targets) {
		var n = key.length;
		var nT = targets.length;
		var matchedMask = 0;
		var fullMask = (1 << nT) - 1;
		var tokenCount = 0;
		var tokenStart = 0;
		var i;
		for (i = 0; i <= n; i++) {
			if (i !== n && key.charCodeAt(i) !== 44 /* ',' */) continue;
			// Token = key[tokenStart .. i)
			tokenCount++;
			// Names can contain spaces, so the rank, when present,
			// is always the trailing digit run after the last space
			// in the token.
			var rankStart = i;
			while (rankStart > tokenStart) {
				var ch = key.charCodeAt(rankStart - 1);
				if (ch < 48 || ch > 57) break;
				rankStart--;
			}
			var rank = 1;
			var nameEnd = i;
			if (rankStart < i && rankStart > tokenStart && key.charCodeAt(rankStart - 1) === 32 /* ' ' */) {
				rank = 0;
				for (var rd = rankStart; rd < i; rd++) {
					rank = rank * 10 + (key.charCodeAt(rd) - 48);
				}
				nameEnd = rankStart - 1; // exclude the space
			}
			for (var ti = 0; ti < nT; ti++) {
				var bit = 1 << ti;
				if (matchedMask & bit) continue;
				var target = targets[ti];
				if (rank < target.minRank) continue;
				var tname = target.name;
				var tlen = tname.length;
				if (nameEnd - tokenStart !== tlen) continue;
				var ok = true;
				for (var c = 0; c < tlen; c++) {
					if (key.charCodeAt(tokenStart + c) !== tname.charCodeAt(c)) { ok = false; break; }
				}
				if (ok) {
					matchedMask |= bit;
					break;
				}
			}
			// Reject outcome if any perk in it is blacklisted.
			// Only when a blacklist is active.
			if (activeBlacklist && activeBlacklist[key.substring(tokenStart, nameEnd)]) {
				return -1;
			}
			tokenStart = i + 1;
		}
		if ((matchedMask & fullMask) !== fullMask) return -1;
		if (targets.exactCount && tokenCount !== nT) return -1;
		// "(EMPTY)" blacklist.
		if (activeBlacklistEmpty && tokenCount === nT) return -1;
		return tokenCount;
	}

	// Reduce a getMaterialsProb-style result map ({ "Perk N,Perk M": prob, … },
	// with '' = no-effect) into { prob, noEffect, topKey } for the targets.
	// sums the raw probabilities of every result-key that satisfies the target
	// perks (with their minRank).
	function summarizeResultMap(result, targets) {
		if (result.err) return { prob: 0, noEffect: 0, topKey: null };
		var noEffectProb = result[''] || 0;
		var effProb = 1 - noEffectProb;
		var sumMatchPerAttempt = 0;
		var bestByLen = Object.create(null);
		var maxLen = 0;

		var keys = Object.keys(result);
		var nT = targets.length;
		var nK = keys.length;
		for (var ki = 0; ki < nK; ki++) {
			var rk = keys[ki];
			if (rk === '' || rk === 'err') continue;
			var canMatch = true;
			for (var ti = 0; ti < nT; ti++) {
				if (!keyContainsPerkName(rk, targets[ti].name)) { canMatch = false; break; }
			}
			if (!canMatch) continue;

			var len = checkKeyMatchLen(rk, targets);
			if (len < 0) continue;
			var p = result[rk];
			sumMatchPerAttempt += p;
			if (len > maxLen) maxLen = len;
			if (!bestByLen[len] || p > bestByLen[len].prob) {
				bestByLen[len] = { key: rk, prob: p };
			}
		}
		var topKey = bestByLen[maxLen] ? bestByLen[maxLen].key : null;
		return {
			prob: effProb > 0 ? sumMatchPerAttempt / effProb : 0,
			noEffect: noEffectProb,
			topKey: topKey
		};
	}

	function evalLevel(lvl, combo, gizmoType, ancient, targets, prob) {
		return summarizeResultMap(prob.getMaterialsProb(lvl, gizmoType, combo, ancient), targets);
	}

	// === Budget distribution cache ===
	// The invent-budget distribution depends only on (level, ancient) and not
	// on the materials, so across a whole search, it's computed at most a few
	// hundred times instead of once per getMaterialsProb call.
	var _budgetCache = Object.create(null);
	function getBudgetCached(prob, lvl, ancient) {
		var key = lvl + (ancient ? 'A' : 'R');
		var c = _budgetCache[key];
		if (c === undefined) {
			c = prob.getBudgetDistribution(lvl, ancient);
			_budgetCache[key] = c;
		}
		return c;
	}

	// Fast-path single-level evaluation: combine a pre-computed, level-
	// independent perk-rank distribution.
	function evalLevelFast(lvl, perkRankProbs, ancient, targets, prob) {
		var contribution = getBudgetCached(prob, lvl, ancient);
		return summarizeResultMap(prob.combineGizmoProb(perkRankProbs, contribution, lvl), targets);
	}

	// Find the levels ([1, maxLevel]) with the highest matching probability
	// for a given condition.
	//
	// Strategy:
	//   1. Sparse pre-sample at 5 evenly-spaced levels including the endpoints.
	//      This anchors the ternary search in a region known to contain the
	//      peak, and serves as a cheap "is this combo viable at all" check.
	//      If every pre-sample is 0, we bail out without ternary or linear
	//      scan. Critical for combos whose only matching outcomes live in a
	//      narrow high-level window (e.g. ancient-only rank 6+ perks). The
	//      pre-sample at maxLevel catches the spike, the bracket is then
	//      narrowed around it, and ternary searches inside the non-zero region
	//      where it's actually unimodal.
	//   2. Ternary search inside the bracketed sub-range.
	//   3. Linear-scan the final bracket plus extend outward to capture every
	//      tying level on either side of the peak.
	// Unimodality holds within any monotonic region because per-perk dice
	// contributions are level-independent and only the budget dice
	// (5x of size 20+floor(L/2)) shift with L. The flat-zero prefix breaks
	// it; the pre-sample step exists to detect and skip past that.
	function findPeak(combo, gizmoType, ancient, targets, prob, maxLevel) {
		// Relative tolerance for the across-level "tie" comparisons.
		// Using a RELATIVE epsilon to surface combos with miniscule chances while
		// keeping tie/plateau grouping proportional.
		var REL = 1e-6;
		var cache = Object.create(null);
		
		var perkRankProbs = null;
		if (prob.getPerkRankProbabilities && prob.combineGizmoProb && prob.getBudgetDistribution) {
			perkRankProbs = prob.getPerkRankProbabilities(gizmoType, combo, ancient);
			// getPerkRankProbabilities returns an {err} object (not an
			// array) when the combo yields no perks at all.
			// Fallback handles it, returning prob 0 via summarizeResultMap's
			// err branch.
			if (!Array.isArray(perkRankProbs)) perkRankProbs = null;
		}
		function ev(lvl) {
			if (cache[lvl] !== undefined) return cache[lvl];
			var v = perkRankProbs
				? evalLevelFast(lvl, perkRankProbs, ancient, targets, prob)
				: evalLevel(lvl, combo, gizmoType, ancient, targets, prob);
			cache[lvl] = v;
			return v;
		}

		// === Step 1: Sparse pre-sample to anchor ternary bracket ===
		// 5 samples for maxLevel >= 4; otherwise just sample every level.
		var sampleLevels;
		if (maxLevel <= 5) {
			sampleLevels = [];
			for (var sl = 1; sl <= maxLevel; sl++) sampleLevels.push(sl);
		} else {
			var quarter = Math.max(1, Math.floor(maxLevel / 4));
			sampleLevels = [1, quarter, 2 * quarter, 3 * quarter, maxLevel];
		}
		var bestSampleProb = 0, bestSampleLvl = 1;
		var anyNonZero = false;
		for (var si = 0; si < sampleLevels.length; si++) {
			var sp = ev(sampleLevels[si]).prob;
			if (sp > 0) anyNonZero = true;
			if (sp > bestSampleProb * (1 + REL)) {
				bestSampleProb = sp;
				bestSampleLvl = sampleLevels[si];
			}
		}

		if (!anyNonZero) return { prob: 0, levels: [], noEffect: 0, topKey: null };

		// === Step 2: Ternary search in the bracket around best sample ===
		// Bracket = best sample ± one sample-step. This gives ternary a
		// region small enough to converge fast (~5 probes) and large enough
		// to absorb the true peak even if sparse samples landed off-peak.
		var bracketStep = (maxLevel <= 5) ? maxLevel : Math.max(1, Math.floor(maxLevel / 4));
		var lo = Math.max(1, bestSampleLvl - bracketStep);
		var hi = Math.min(maxLevel, bestSampleLvl + bracketStep);
		while (hi - lo > 3) {
			var m1 = Math.floor(lo + (hi - lo) / 3);
			var m2 = Math.floor(lo + 2 * (hi - lo) / 3);
			if (m1 >= m2) break;
			var p1 = ev(m1).prob;
			var p2 = ev(m2).prob;
			if (p1 < p2 * (1 - REL)) lo = m1 + 1;
			else if (p2 < p1 * (1 - REL)) hi = m2 - 1;
			else { lo = m1 + 1; hi = m2 - 1; }
		}

		// === Step 3: Linear scan inside bracket + extend for ties ===
		var bestProb = 0, bestLevels = [], bestNoEffect = 0, bestTopKey = null;
		var scanLo = Math.max(1, Math.min(lo, bestSampleLvl));
		var scanHi = Math.min(maxLevel, Math.max(hi, bestSampleLvl));
		for (var lvl = scanLo; lvl <= scanHi; lvl++) {
			var e = ev(lvl);
			if (e.prob > bestProb * (1 + REL)) {
				bestProb = e.prob;
				bestLevels = [lvl];
				bestNoEffect = e.noEffect;
				bestTopKey = e.topKey;
			} else if (bestProb > 0 && Math.abs(e.prob - bestProb) <= bestProb * REL) {
				bestLevels.push(lvl);
			}
		}

		if (bestLevels.length === 0) return { prob: 0, levels: [], noEffect: 0, topKey: null };

		// Extend outward to catch plateau levels outside the ternary bracket.
		var minL = bestLevels[0];
		var maxL = bestLevels[bestLevels.length - 1];
		for (var l = minL - 1; l >= 1; l--) {
			var e2 = ev(l);
			if (Math.abs(e2.prob - bestProb) <= bestProb * REL) bestLevels.push(l);
			else break;
		}
		for (l = maxL + 1; l <= maxLevel; l++) {
			var e3 = ev(l);
			if (Math.abs(e3.prob - bestProb) <= bestProb * REL) bestLevels.push(l);
			else break;
		}

		return { prob: bestProb, levels: bestLevels, noEffect: bestNoEffect, topKey: bestTopKey };
	}

	// Find the best (permutation, level) for a single combo. Applies the
	// permutation hybrid on top of findPeak's level sweep. Returns
	// { materials, probPerGizmo, bestLevels, noEffectProb, permutationsTried },
	// or null if no matching permutation reaches prob > 0.
	function evaluateOneCombo(combo, gizmoType, ancient, targets, prob, invLevel, rsPerks, shouldCancel, onSubprogress) {
		var EPS = 1e-7;
		var bestRow = null;
		var permsTried = 1;
		var permsEvaluated = 0;

		// Notifies the (optional, throttled) subprogress callback once
		// per findPeak that finishes during this combo's evaluation.
		// Each event carries (permsCurrent, permsTotal, phase) so the
		// UI can render "permutation X / Y (phase)".
		// Phases:
		//   - canonical: 1 (order-invariant combo, single findPeak).
		//   - heuristic/probe: 1 + uniqueProbes (after dedup, ≤ 6).
		//   - exhaustive: the order-changing orderings (D! distinct-material
		//     block orderings), else multiset perms up to PERM_CAP.
		function notifySub(phase, permsTotal) {
			permsEvaluated++;
			if (onSubprogress) onSubprogress({
				permsCurrent: permsEvaluated,
				permsTotal: permsTotal,
				phase: phase
			});
		}

		var nonEmpty = [];
		var emptyCount = 0;
		for (var i = 0; i < combo.length; i++) {
			if (combo[i] === '') emptyCount++;
			else nonEmpty.push(combo[i]);
		}

		function withEmpties(arr) {
			var out = arr.slice();
			for (var ei = 0; ei < emptyCount; ei++) out.push('');
			return out;
		}

		function consider(perm, peak) {
			if (peak.prob <= 0) return;
			if (!bestRow || peak.prob > bestRow.probPerGizmo + EPS) {
				bestRow = {
					materials: withEmpties(perm),
					probPerGizmo: peak.prob,
					bestLevels: peak.levels.slice(),
					noEffectProb: peak.noEffect,
					topResultKey: peak.topKey
				};
			}
		}

		// A combo's outcome is order-sensitive only if either
		// a) the 20-perk cap will be hit, or
		// b) the combo has >1 distinct material AND a target-bumping cost
		//    tie among its producible perks.
		var uniquePerks = comboUniquePerksCount(nonEmpty, gizmoType, rsPerks);
		var orderMatters = uniquePerks > 20 ||
			(nonEmpty.length > 1 && comboDistinctMatsCount(nonEmpty) > 1 &&
				comboOrderSensitive(nonEmpty, gizmoType, targets, rsPerks));
		if (!orderMatters) {
			consider(nonEmpty, findPeak(withEmpties(nonEmpty), gizmoType, ancient, targets, prob, invLevel));
			notifySub('canonical', 1);
		} else {
			var ord = probeOrderings(nonEmpty, gizmoType, targets, rsPerks);
			// Count unique probes upfront so the subprogress can show a
			// stable "X / Y" denominator during the heuristic+probe phase
			var probeBudget = 1;
			var seenProbeKeys = Object.create(null);
			seenProbeKeys[ord.heuristic.join('|')] = true;
			for (var spi = 0; spi < ord.probes.length; spi++) {
				var spk = ord.probes[spi].join('|');
				if (!seenProbeKeys[spk]) {
					seenProbeKeys[spk] = true;
					probeBudget++;
				}
			}
			var heurPerm = withEmpties(ord.heuristic);
			var heurPeak = findPeak(heurPerm, gizmoType, ancient, targets, prob, invLevel);
			consider(ord.heuristic, heurPeak);
			notifySub('heuristic', probeBudget);

			// Probe orderings collide whenever the sort keys tie.
			// Track seen permutations and skip duplicates.
			var seenProbes = Object.create(null);
			seenProbes[ord.heuristic.join('|')] = true;
			var anyProbeBeats = false;
			permsTried = 1;
			for (var pp = 0; pp < ord.probes.length; pp++) {
				if (shouldCancel && shouldCancel()) return null;
				var probeKey = ord.probes[pp].join('|');
				if (seenProbes[probeKey]) continue;
				seenProbes[probeKey] = true;
				var probePerm = withEmpties(ord.probes[pp]);
				var probePeak = findPeak(probePerm, gizmoType, ancient, targets, prob, invLevel);
				consider(ord.probes[pp], probePeak);
				if (probePeak.prob > heurPeak.prob + EPS) anyProbeBeats = true;
				permsTried++;
				notifySub('probe', probeBudget);
			}

			if (anyProbeBeats) {
				// The probes disagreed, so the combo is genuinely order-sensitive.
				// Enumerate orderings that can change result:
				//   - cap not hit: only the distinct-material order matters.
				//   - cap hit: later positions decide which perks survive, so the
				//     full multiset permutation matters.
				var PERM_CAP = 200;
				var allPerms = uniquePerks <= 20
					? distinctMaterialPermutations(nonEmpty, 720)
					: (multinomialCount(nonEmpty) <= PERM_CAP ? distinctPermutations(nonEmpty) : null);
				if (allPerms) {
					var seen = Object.create(null);
					seen[ord.heuristic.join('|')] = true;
					for (var sp = 0; sp < ord.probes.length; sp++) seen[ord.probes[sp].join('|')] = true;
					for (var ap = 0; ap < allPerms.length; ap++) {
						if (shouldCancel && shouldCancel()) return null;
						var key = allPerms[ap].join('|');
						if (seen[key]) continue;
						consider(allPerms[ap], findPeak(withEmpties(allPerms[ap]), gizmoType, ancient, targets, prob, invLevel));
						notifySub('exhaustive', allPerms.length);
					}
					permsTried = allPerms.length;
				}
			}
		}

		if (!bestRow) return null;
		bestRow.permutationsTried = permsTried;
		return bestRow;
	}

	function search(opts) {
		var rsPerks = opts.rsPerks;
		var prob = opts.prob;
		var targets = opts.targets;
		var gizmoTypes = opts.gizmoTypes || ['weapon', 'armour', 'tool'];
		var ancientModes = opts.ancientModes != null ? opts.ancientModes : [false, true];
		var invLevel = opts.invLevel != null ? opts.invLevel : 137;
		var maxDistinctMats = opts.maxDistinctMats === undefined ? 3 : opts.maxDistinctMats;
		var onResult = opts.onResult;
		var onProgress = opts.onProgress;
		var shouldCancel = opts.shouldCancel;
		// Workers should snapshot rsPerkCalc.materialPrices and pass it here.
		var materialPrices = opts.materialPrices || {};
		var gizmoPrices = opts.gizmoPrices || {};

		if (!targets || targets.length === 0 || targets.length > 2) {
			throw new Error('targets must be an array of 1 or 2 perks');
		}
		for (var t = 0; t < targets.length; t++) {
			if (targets[t].minRank == null) targets[t].minRank = 1;
			if (!rsPerks.perks[targets[t].name]) throw new Error('Unknown perk: ' + targets[t].name);
		}
		if (targets.length === 2) {
			for (var t = 0; t < 2; t++) {
				if (rsPerks.perks[targets[t].name].doubleslot) {
					throw new Error('Doubleslot perk "' + targets[t].name + '" cannot be paired with another perk');
				}
			}
		}

		// Perk blacklist.
		activeBlacklistEmpty = !!opts.blacklistEmpty;
		activeBlacklist = null;
		if (opts.blacklist && opts.blacklist.length) {
			var blTargets = {};
			for (var bt = 0; bt < targets.length; bt++) blTargets[targets[bt].name] = true;
			var bl = {}, anyBl = false;
			for (var bi = 0; bi < opts.blacklist.length; bi++) {
				var bname = opts.blacklist[bi];
				if (bname && !blTargets[bname] && rsPerks.perks[bname]) { bl[bname] = true; anyBl = true; }
			}
			if (anyBl) activeBlacklist = bl;
		}

		// Optional cheap pre-scorer. If provided, all candidate combos for a
		// given (gizmoType, ancient) are enumerated and scored before any
		// findPeak calls, then evaluated in score-descending order so that
		// users see useful combos first.
		var scoreFn = opts.scoreFn;

		var keepResultsArray = !onResult;
		var allResults = keepResultsArray ? [] : null;

		// Throttled subprogress callback.
		var onSubprogress = opts.onSubprogress;
		var lastSubMs = 0;
		var subprogressThrottled = onSubprogress ? function (data) {
			var now = Date.now();
			if (now - lastSubMs > 200) {
				lastSubMs = now;
				onSubprogress(data);
			}
		} : null;

		function emitRow(combo, gizmoType, ancient) {
			var bestRow = evaluateOneCombo(combo, gizmoType, ancient, targets, prob, invLevel, rsPerks, shouldCancel, subprogressThrottled);
			if (!bestRow) return;
			bestRow.gizmoType = gizmoType;
			bestRow.ancient = ancient;
			if (onResult) onResult(bestRow);
			if (keepResultsArray) allResults.push(bestRow);
		}

		// Resolve the per-(gizmoType, ancient) candidate pool and per-target
		// contributor sets. Returns null if any target has no contributor on
		// this gizmo type. `includeFiller` widens the pool to every material
		// producing any perk on the gizmo type
		function buildConfig(gizmoType, ancient, includeFiller) {
			// Skip infeasible gizmos.
			for (var ti0 = 0; ti0 < targets.length; ti0++) {
				var perkData0 = rsPerks.perks[targets[ti0].name];
				if (!perkData0 || !perkData0.ranks) return null;
				var rank0 = targets[ti0].minRank || 1;
				if (rank0 > perkData0.ranks.length) return null;
				var rankData0 = perkData0.ranks[rank0 - 1];
				if (rankData0.ancientOnly === 1 && !ancient) return null;
			}

			var contributorSets = [];
			var candidatesSet = { '': true };
			for (var ti = 0; ti < targets.length; ti++) {
				var perkName = targets[ti].name;
				var set = {};
				for (var mat in rsPerks.comps) {
					// Ancient-only mats cannot be placed in a regular gizmo.
					if (!ancient && rsPerks.comps[mat].ancient === true) continue;
					var list = rsPerks.comps[mat][gizmoType];
					if (!list) continue;
					for (var p = 0; p < list.length; p++) {
						if (list[p].perk === perkName) {
							set[mat] = true;
							candidatesSet[mat] = true;
							break;
						}
					}
				}
				contributorSets.push(set);
			}

			// Widen the pool with filler materials when asked to
			if (includeFiller) {
				for (var fillerMat in rsPerks.comps) {
					if (!ancient && rsPerks.comps[fillerMat].ancient === true) continue;
					var fillerList = rsPerks.comps[fillerMat][gizmoType];
					if (fillerList && fillerList.length > 0) {
						candidatesSet[fillerMat] = true;
					}
				}
			}

			for (var ti2 = 0; ti2 < contributorSets.length; ti2++) {
				if (Object.keys(contributorSets[ti2]).length === 0) return null;
			}

			// Sort matsArr by heuristic potential, descending.
			var targetNamesSet = Object.create(null);
			for (var ti3 = 0; ti3 < targets.length; ti3++) targetNamesSet[targets[ti3].name] = true;
			var matsArr = Object.keys(candidatesSet).sort(function (a, b) {
				return heuristicMatScore(b, gizmoType, targetNamesSet, rsPerks) -
					heuristicMatScore(a, gizmoType, targetNamesSet, rsPerks);
			});

			var nMats = matsArr.length;
			var slots = ancient ? 9 : 5;
			var nTargets = targets.length;

			// emptyIdx: the '' sentinel's position in the sorted matsArr.
			// 
			// heuristicMatScore('') = -1e9 so it normally lands last. Computing
			// it explicitly to be robust against any future sort changes.
			var emptyIdx = -1;
			for (var ei = 0; ei < nMats; ei++) {
				if (matsArr[ei] === '') { emptyIdx = ei; break; }
			}

			// === Precomputed contribution + price tables ===
			// contribTable[t][i] = MEAN (base + roll/2) summed across
			// all of material matsArr[i]'s perks matching target t.
			//
			// contribTableMax[t][i] = MAX (base + roll)
			// Used by the score-bound enumerator to detect "actual
			// probability is definitively 0" sub-trees. Pruning these
			// costs nothing and skips a massive amount of useless enumeration.
			var contribTable = new Array(nTargets);
			var contribTableMax = new Array(nTargets);
			// contribTableVar[t][i] = VARIANCE of material i's contribution.
			var contribTableVar = new Array(nTargets);
			for (var t = 0; t < nTargets; t++) {
				contribTable[t] = new Float64Array(nMats);
				contribTableMax[t] = new Float64Array(nMats);
				contribTableVar[t] = new Float64Array(nMats);
			}
			for (var i = 0; i < nMats; i++) {
				var mat = matsArr[i];
				if (!mat) continue;
				var data = rsPerks.comps[mat];
				if (!data) continue;
				var perkList = data[gizmoType];
				if (!perkList) continue;
				var penalize = (ancient && data.ancient !== true);
				for (var pi = 0; pi < perkList.length; pi++) {
					var perkEntry = perkList[pi];
					for (var tt = 0; tt < nTargets; tt++) {
						if (perkEntry.perk !== targets[tt].name) continue;
						var base = perkEntry.base;
						var roll = perkEntry.roll;
						if (penalize) {
							base = Math.floor(base * 0.8);
							roll = Math.floor(roll * 0.8);
						}
						contribTable[tt][i] += base + roll / 2;
						contribTableMax[tt][i] += base + roll;
						contribTableVar[tt][i] += roll * (roll + 2) / 12;
					}
				}
			}

			var priceTable = new Float64Array(nMats);
			for (var pi2 = 0; pi2 < nMats; pi2++) {
				var price = materialPrices[matsArr[pi2]];
				if (price) priceTable[pi2] = price;
			}
			// Per-attempt gizmo shell cost for this config (0 when ignored upstream).
			var gizmoBaseline = gizmoPrices[(ancient ? 'ancient ' : '') + gizmoType] || 0;

			// Raw rank threshold for target t.
			// Used both by the inline scorer and the score-bound
			// enumerator. Must reach this for the rank to ever fire.
			var thresholds = new Float64Array(nTargets);
			for (var tb = 0; tb < nTargets; tb++) {
				var pdata = rsPerks.perks[targets[tb].name];
				var rk = targets[tb].minRank || 1;
				thresholds[tb] = pdata.ranks[rk - 1].threshold;
			}

			// === Coverage-bound bitmasks ===
			// itemMask[i] = bitmask of targets that material matsArr[i]
			// contributes to.
			// contribAvail[i] = bitmask of targets reachable from
			// items[i..n-1] (built right-to-left), so a node at startIdx
			// = i can check whether the still-uncovered targets can
			// still be covered by any future pick.
			var itemMask = new Int32Array(nMats);
			for (var im = 0; im < nMats; im++) {
				var m = 0;
				for (var ct = 0; ct < nTargets; ct++) {
					if (contributorSets[ct][matsArr[im]]) m |= (1 << ct);
				}
				itemMask[im] = m;
			}
			var contribAvail = new Int32Array(nMats + 1);
			for (var ca = nMats - 1; ca >= 0; ca--) {
				contribAvail[ca] = contribAvail[ca + 1] | itemMask[ca];
			}
			var allCoveredMask = (1 << nTargets) - 1;

			// isContributorIdx[i] = 1 if matsArr[i] contributes to a target
			// (itemMask != 0) or is the empty sentinel; filler materials are 0.
			var isContributorIdx = new Uint8Array(nMats);
			for (var ici = 0; ici < nMats; ici++) {
				isContributorIdx[ici] = (matsArr[ici] === '' || itemMask[ici] !== 0) ? 1 : 0;
			}

			// === Score-bound: maxContribMaxRemaining[t][i] ===
			// Maximum contribution reachable from any single
			// material in items[i..n-1].
			var maxContribMaxRemaining = new Array(nTargets);
			for (var mt = 0; mt < nTargets; mt++) {
				var arr = new Float64Array(nMats + 1);
				var mxTable = contribTableMax[mt];
				for (var mi = nMats - 1; mi >= 0; mi--) {
					var c = mxTable[mi];
					arr[mi] = c > arr[mi + 1] ? c : arr[mi + 1];
				}
				maxContribMaxRemaining[mt] = arr;
			}

			return {
				contributorSets: contributorSets,
				matsArr: matsArr,
				slots: slots,
				nMats: nMats,
				nTargets: nTargets,
				emptyIdx: emptyIdx,
				contribTable: contribTable,
				contribTableMax: contribTableMax,
				contribTableVar: contribTableVar,
				priceTable: priceTable,
				gizmoBaseline: gizmoBaseline,
				thresholds: thresholds,
				itemMask: itemMask,
				contribAvail: contribAvail,
				allCoveredMask: allCoveredMask,
				maxContribMaxRemaining: maxContribMaxRemaining,
				isContributorIdx: isContributorIdx
			};
		}

		if (scoreFn) {
			// Top-K global heap streamer with bounded-enumeration Phase
			// 1, score-descending Phase 2 drain, and resumable bounded
			// Phase 3 tail.
			// Heap stores indexed combos (Int32Array) plus the source
			// matsArr so emit can convert back to material names on the
			// way out.
			var K = 10000;

			// Cap on filler combos the initial scan promotes into the results
			// table. The long tail of weaker filler combos streams during the
			// filler stage.
			var FILLER_SURFACE_CAP = 500;

			// Relevance floor: the top-K heap drains best-score
			// first. Once next combo's score drops below ~100x less cost-efficient
			// than the best, pause calc.
			var RELEVANCE_RATIO = 0.01;

			// Filler materials will not be used for double slot perks
			var anyDoubleslot = false;
			for (var ds = 0; ds < targets.length; ds++) {
				var dsd = rsPerks.perks[targets[ds].name];
				if (dsd && dsd.doubleslot) anyDoubleslot = true;
			}

			// Build a config per (gizmoType, ancient) and decide its filler
			// policy:
			//   cfgR: restricted pool (contributors only). Used for Phase 1
			//   + the restricted tail. Always present.
			//   cfgE: expanded pool (with filler). Only when filler is needed
			var configs = [];
			var anyFillerConfig = false;
			var grandTotalCandidates = 0;
			for (var g = 0; g < gizmoTypes.length; g++) {
				for (var am = 0; am < ancientModes.length; am++) {
					if (shouldCancel && shouldCancel()) return allResults || [];
					var gizmoType = gizmoTypes[g];
					var ancient = ancientModes[am];
					var cfgR = buildConfig(gizmoType, ancient, false);
					if (!cfgR) continue;
					var cfgE = null;
					if (!anyDoubleslot) {
						if (targets.length === 1 && !targets.exactCount) {
							// (ANY): expand the MAIN pool; no separate filler phase.
							cfgR = buildConfig(gizmoType, ancient, true);
						} else if (targetsCanTie(gizmoType, targets, rsPerks, cfgR.matsArr)) {
							cfgE = buildConfig(gizmoType, ancient, true);
							anyFillerConfig = true;
						}
					}
					// Total candidate count reflects the full (expanded if any)
					// space so the progress denominator covers both phases.
					var countCfg = cfgE || cfgR;
					var candCount = countCandidateCombos(countCfg.slots, countCfg.matsArr.length, maxDistinctMats);
					configs.push({
						cfgR: cfgR,
						cfgE: cfgE,
						gizmoType: gizmoType,
						ancient: ancient,
						candCount: candCount
					});
					grandTotalCandidates += candCount;
				}
			}

			if (onProgress) onProgress({
				phase: 'enumerating',
				enumerated: 0,
				totalCandidates: grandTotalCandidates
			});

			// Phase 1 enumeration:
			//
			// Cross-gizmo interleaving: the heap is shared by every
			// (gizmoType, ancient) config, so the eventual Phase 2
			// emission is globally score-ordered.
			//
			// Streaming emit during enumeration: every
			// INTERLEAVE_CHUNK enumerated combos, take a snapshot of the
			// heap's top-INTERLEAVE_BATCH entries by score and run them
			// through emitRow.
			// This means, on huge searches, rows start appearing in the
			// table seconds after submit, instea of after the entire
			// lengthy enumeration completes.
			// Entries are NOT removed from the heap by the interleave.
			// They may still be displaced by a higher-score combo later,
			// but they're tracked in emittedKeys so the final drain doesn't
			// re-emit them. A tiny amount of over-emission is acceptable: the
			// displaced row is still a valid result, just not in the final
			// top, by score. The table sort surfaces the best ones to the
			// top anyway.
			var INTERLEAVE_CHUNK = 200000;
			var INTERLEAVE_BATCH = 3;
			var enumSinceLastEmit = 0;
			var totalEnumerated = 0;
			var lastEnumProgressMs = onProgress ? Date.now() : 0;
			var grandTotal = 0;
			var heap = new MinHeap();
			// Separate top-N heap for auto-surfaced filler combos. Kept
			// apart from the main heap so fillers can't crowd contributors
			// out of the top-K; both are merged for emission.
			var fillerHeap = null;
			var emittedKeys = Object.create(null);
			var evaluatedSoFar = 0;

			// Lazy key string for heap entries:
			// built only when an entry is about to emit.
			function entryKey(e) {
				return e.prefix + e.comboIdx.join(',');
			}

			// Called only on emits, so the per-call allocation cost is bounded.
			function indicesToNames(comboIdx, matsArr) {
				var n = comboIdx.length;
				var out = new Array(n);
				for (var i = 0; i < n; i++) out[i] = matsArr[comboIdx[i]];
				return out;
			}

			function interleaveEmitSnapshot() {
				if (heap.size() === 0) return;
				// Sort a shallow copy of the heap's internal array by
				// descending score and emit the first INTERLEAVE_BATCH
				// entries that haven't already been emitted. The heap
				// itself is untouched.
				var snapshot = heap._arr.slice();
				snapshot.sort(function (a, b) { return b.score - a.score; });
				var emitted = 0;
				for (var sj = 0; sj < snapshot.length && emitted < INTERLEAVE_BATCH; sj++) {
					if (shouldCancel && shouldCancel()) return;
					var e = snapshot[sj];
					var k = entryKey(e);
					if (emittedKeys[k]) continue;
					emittedKeys[k] = true;
					emitRow(indicesToNames(e.comboIdx, e.matsArr), e.gizmoType, e.ancient);
					evaluatedSoFar++;
					if (onProgress && evaluatedSoFar % 10 === 0) {
						onProgress({ phase: 'evaluating', current: evaluatedSoFar, total: grandTotalCandidates });
					}
					emitted++;
				}
			}

			// Round-robin bulk enumeration across ALL configs. The
			// global heap accumulates entries from every config
			// simultaneously, so interleave snapshots stay
			// cross-config (Gizmo type/variant) representative.
			var enums = [];
			for (var ei0 = 0; ei0 < configs.length; ei0++) {
				var cfg0 = configs[ei0];
				enums.push({
					cfg: cfg0.cfgR,
					enumerator: createBoundedEnumerator(cfg0.cfgR, maxDistinctMats),
					gizmoType: cfg0.gizmoType,
					ancient: cfg0.ancient,
					prefix: cfg0.gizmoType + '|' + (cfg0.ancient ? 'A' : 'R') + '|',
					count: 0,
					done: false
				});
			}

			// Process CHUNK_PER_ROTATION combos from each config
			// before rotating to the next.
			// With INTERLEAVE_CHUNK=200000 and 6 gizmo configs,
			// a chunk of 4096 still gives ~8 rotations per snapshot.
			var CHUNK_PER_ROTATION = 4096;
			var activeCount = enums.length;
			while (activeCount > 0) {
				if (shouldCancel && shouldCancel()) return allResults || [];
				for (var ei = 0; ei < enums.length; ei++) {
					var e = enums[ei];
					if (e.done) continue;
					// Hoist per-config refs and primitives out of the
					// inner chunk loop so V8 keeps them in registers.
					var enumerator = e.enumerator;
					var ecfg = e.cfg;
					var nTargetsLocal = ecfg.nTargets;
					var slotsLocal = ecfg.slots;
					var contribTableLocal = ecfg.contribTable;
					var contribTableVarLocal = ecfg.contribTableVar;
					var thresholdsLocal = ecfg.thresholds;
					var priceTableLocal = ecfg.priceTable;
					var gizmoBaselineLocal = ecfg.gizmoBaseline;
					var matsArrLocal = ecfg.matsArr;
					var gtLocal = e.gizmoType;
					var ancLocal = e.ancient;
					var prefixLocal = e.prefix;
					for (var c = 0; c < CHUNK_PER_ROTATION; c++) {
						var comboIdx = enumerator.next();
						if (comboIdx === null) {
							e.done = true;
							activeCount--;
							break;
						}
						totalEnumerated++;
						enumSinceLastEmit++;
						// Bitwise check every 65536 iterations is
						// cheaper than a modulo and frequent enough
						// that the time-throttle gates the actual
						// postMessage rate.
						if (onProgress && (totalEnumerated & 0xFFFF) === 0) {
							var nowMs = Date.now();
							if (nowMs - lastEnumProgressMs > 500) {
								lastEnumProgressMs = nowMs;
								onProgress({
									phase: 'enumerating',
									enumerated: totalEnumerated,
									totalCandidates: grandTotalCandidates
								});
							}
						}
						e.count++;

						// === Inline scoring ===
						var jointProb = 1.0;
						for (var tt = 0; tt < nTargetsLocal; tt++) {
							var table = contribTableLocal[tt];
							var vtable = contribTableVarLocal[tt];
							var s = 0, vs = 0;
							for (var si = 0; si < slotsLocal; si++) {
								var ix = comboIdx[si];
								s += table[ix];
								vs += vtable[ix];
							}
							var p = rankReachProb(s, vs, thresholdsLocal[tt]);
							if (p <= SCORE_EPS) { jointProb = 0; break; }
							jointProb *= p;
						}
						if (jointProb <= 0) continue;
						var cost = gizmoBaselineLocal;
						for (var ci = 0; ci < slotsLocal; ci++) cost += priceTableLocal[comboIdx[ci]];
						var score = (cost > 0) ? jointProb / cost : jointProb;

						// Heap entry: lazy key (built only at emit),
						// indexed combo copied via Int32Array.slice
						// so the enumerator can mutate its buffer
						// for the next next() call.
						if (heap.size() < K) {
							heap.push({
								comboIdx: comboIdx.slice(),
								matsArr: matsArrLocal,
								prefix: prefixLocal,
								score: score,
								gizmoType: gtLocal,
								ancient: ancLocal
							});
						} else if (score > heap.peek().score) {
							heap.replaceTop({
								comboIdx: comboIdx.slice(),
								matsArr: matsArrLocal,
								prefix: prefixLocal,
								score: score,
								gizmoType: gtLocal,
								ancient: ancLocal
							});
						}

						// Interleaved emit: pauses enumeration
						// briefly to run emitRow on the heap's
						// current top entries (sorted by score
						// desc), giving the user visible results
						// while enumeration is still in progress.
						//
						// Could potentially be split into a separate
						// thread, but current architecture of project
						// doesn't yet support that. Though the time
						// save from that is negligible relative to the
						// total enumeration time anyway.
						if (enumSinceLastEmit >= INTERLEAVE_CHUNK) {
							enumSinceLastEmit = 0;
							interleaveEmitSnapshot();
						}
					}
				}
			}

			// Scoring fillers
			if (anyFillerConfig) {
				var FILLER_SCAN_BUDGET = 3000000;
				var FILLER_SCAN_MS = 800;
				var fillerScanned = 0;
				var fillerScanStart = Date.now();
				fillerHeap = new MinHeap();
				for (var fsc = 0; fsc < configs.length; fsc++) {
					if (fillerScanned >= FILLER_SCAN_BUDGET) break;
					if (Date.now() - fillerScanStart > FILLER_SCAN_MS) break;
					var fScfg = configs[fsc].cfgE;
					if (!fScfg) continue;
					if (shouldCancel && shouldCancel()) return allResults || [];
					var fScanEnum = createBoundedEnumerator(fScfg, maxDistinctMats);
					var fScontrib = fScfg.isContributorIdx;
					var fSslots = fScfg.slots;
					var fSnTargets = fScfg.nTargets;
					var fScontribTable = fScfg.contribTable;
					var fScontribVar = fScfg.contribTableVar;
					var fSthresholds = fScfg.thresholds;
					var fSpriceTable = fScfg.priceTable;
					var fSgizmoBaseline = fScfg.gizmoBaseline;
					var fSmats = fScfg.matsArr;
					var fSgt = configs[fsc].gizmoType;
					var fSanc = configs[fsc].ancient;
					var fSprefix = fSgt + '|' + (fSanc ? 'A' : 'R') + '|F|';
					while (true) {
						var fScombo = fScanEnum.next();
						if (fScombo === null) break;
						fillerScanned++;
						if ((fillerScanned & 0xFFFF) === 0) {
							if (shouldCancel && shouldCancel()) return allResults || [];
							if (fillerScanned >= FILLER_SCAN_BUDGET) break;
							if (Date.now() - fillerScanStart > FILLER_SCAN_MS) break;
							if (onProgress) {
								var fNow = Date.now();
								if (fNow - lastEnumProgressMs > 500) {
									lastEnumProgressMs = fNow;
									onProgress({
										phase: 'enumerating',
										enumerated: totalEnumerated + fillerScanned,
										totalCandidates: grandTotalCandidates
									});
								}
							}
						}
						// Skip contributor-only combos -- already scored from cfgR.
						var fSisFiller = false;
						for (var fsk = 0; fsk < fSslots; fsk++) {
							if (!fScontrib[fScombo[fsk]]) { fSisFiller = true; break; }
						}
						if (!fSisFiller) continue;
						var fSjoint = 1.0;
						for (var fst = 0; fst < fSnTargets; fst++) {
							var fStable = fScontribTable[fst];
							var fSvtable = fScontribVar[fst];
							var fSsum = 0, fSvs = 0;
							for (var fss = 0; fss < fSslots; fss++) {
								var fix = fScombo[fss];
								fSsum += fStable[fix];
								fSvs += fSvtable[fix];
							}
							var fSp = rankReachProb(fSsum, fSvs, fSthresholds[fst]);
							if (fSp <= SCORE_EPS) { fSjoint = 0; break; }
							fSjoint *= fSp;
						}
						if (fSjoint <= 0) continue;
						var fScost = fSgizmoBaseline;
						for (var fsp2 = 0; fsp2 < fSslots; fsp2++) fScost += fSpriceTable[fScombo[fsp2]];
						var fSscore = (fScost > 0) ? fSjoint / fScost : fSjoint;
						if (fillerHeap.size() < FILLER_SURFACE_CAP) {
							fillerHeap.push({
								comboIdx: fScombo.slice(),
								matsArr: fSmats,
								prefix: fSprefix,
								score: fSscore,
								gizmoType: fSgt,
								ancient: fSanc
							});
						} else if (fSscore > fillerHeap.peek().score) {
							fillerHeap.replaceTop({
								comboIdx: fScombo.slice(),
								matsArr: fSmats,
								prefix: fSprefix,
								score: fSscore,
								gizmoType: fSgt,
								ancient: fSanc
							});
						}
					}
				}
			}

			for (var ei2 = 0; ei2 < enums.length; ei2++) {
				grandTotal += enums[ei2].count;
			}

			// Denominator for the "Evaluated X / Y" status. Normally the
			// actual covering-combo count (grandTotal), so it lands at 100%.
			// When a filler stage will run, its matches push the count past
			// grandTotal, so use the analytical candidate total (an upper
			// bound) instead to avoid X > Y.
			var evaluatingTotal = anyFillerConfig ? grandTotalCandidates : grandTotal;

			if (onProgress) onProgress({
				phase: 'enumerated', total: evaluatingTotal
			});

			// Phase 2: drain the GLOBAL heap into a score-descending
			// array, then emit each entry that wasn't already streamed
			// out by the interleave step. Entries from different gizmo
			// types are interleaved by score, so the user sees the
			// actual top-K of the whole search regardless of which
			// gizmo it belongs to.
			var topK = new Array(heap.size());
			for (var hi = topK.length - 1; hi >= 0; hi--) {
				topK[hi] = heap.pop();
			}
			heap = null;

			// Merge filler combos into emission, then resort.
			if (fillerHeap && fillerHeap.size() > 0) {
				while (fillerHeap.size() > 0) topK.push(fillerHeap.pop());
				topK.sort(function (a, b) { return b.score - a.score; });
			}
			fillerHeap = null;

			var topKLen = topK.length;
			var relevanceFloorScore = topKLen > 0 ? topK[0].score * RELEVANCE_RATIO : 0;
			for (var ti = 0; ti < topKLen; ti++) {
				if (shouldCancel && shouldCancel()) {
					emittedKeys = null;
					return allResults || [];
				}
				var entry = topK[ti];
				if (entry.score < relevanceFloorScore) break; // rest streams in the tail
				// Release the entry's reference in topK before emitRow runs.
				topK[ti] = null;
				var k2 = entryKey(entry);
				if (emittedKeys[k2]) continue;
				emittedKeys[k2] = true;
				emitRow(indicesToNames(entry.comboIdx, entry.matsArr), entry.gizmoType, entry.ancient);
				evaluatedSoFar++;
				if (onProgress && evaluatedSoFar % 10 === 0) {
					onProgress({ phase: 'evaluating', current: evaluatedSoFar, total: evaluatingTotal });
				}
			}
			topK = null;

			// Phase 3 (tail): batched, coverage-bound enumeration.
			//
			// For huge searches, the tail is gigantic. Trying to walk
			// it all in one go locks the worker for hours. Instead, we
			// emit up to TAIL_INITIAL_BUFFER rows now, then return a
			// session object whose `continueTail()` method advances the
			// tail by TAIL_BATCH_SIZE more rows on demand. The worker
			// signals tail-paused to the UI between batches; the user
			// clicks "Continue" if they want more.
			//
			// Coverage-bound enumeration prunes sub-trees whose remaining
			// items can't possibly cover every target, so each batch
			// only walks live branches even when the candidate space is
			// trillions of combos. emittedKeys carries over so the
			// already-emitted top-K plus any previous-batch's tail rows
			// don't re-emit.
			var TAIL_INITIAL_BUFFER = opts.tailInitialBufferSize || 10000;
			var TAIL_BATCH_SIZE = opts.tailBatchSize || 10000;
			var tailConfigIdx = 0;
			var tailDone = false;
			// Two tail stages:
			// 'restricted': contributor-only combos beyond the top-K (cfgR)
			// 'filler': combos containing >=1 filler material (cfgE)
			var tailStage = 'restricted';
			var PAUSE_INTERVAL_MS = 300000;
			var batchStartMs = 0;
			// Per-config enumerators, lazily built, kept across continueTail()
			// calls (the bounded enumerator's internal state is the cursor).
			var tailEnums = new Array(configs.length);
			var fillerConfigIdx = 0;
			var fillerEnums = new Array(configs.length);

			function runTailBatch(batchSize) {
				var batchEmitted = 0;
				while (tailConfigIdx < configs.length) {
					if (shouldCancel && shouldCancel()) return true;
					var tailCtx = configs[tailConfigIdx];
					if (!tailCtx) { tailConfigIdx++; continue; }

					var tailCfg = tailCtx.cfgR;
					var tailGT = tailCtx.gizmoType;
					var tailAnc = tailCtx.ancient;
					var tailPrefix = tailGT + '|' + (tailAnc ? 'A' : 'R') + '|';
					var tailMats = tailCfg.matsArr;
					var tailEnum = tailEnums[tailConfigIdx];
					if (!tailEnum) {
						tailEnum = createBoundedEnumerator(tailCfg, maxDistinctMats);
						tailEnums[tailConfigIdx] = tailEnum;
					}

					while (true) {
						if (shouldCancel && shouldCancel()) return true;
						var comboIdx = tailEnum.next();
						if (comboIdx === null) break;
						var key = tailPrefix + comboIdx.join(',');
						if (emittedKeys[key]) continue;
						emittedKeys[key] = true;
						emitRow(indicesToNames(comboIdx, tailMats), tailGT, tailAnc);
						evaluatedSoFar++;
						batchEmitted++;
						if (onProgress && evaluatedSoFar % 10 === 0) {
							onProgress({ phase: 'evaluating', current: evaluatedSoFar, total: grandTotalCandidates });
						}
						if (batchEmitted >= batchSize || Date.now() - batchStartMs >= PAUSE_INTERVAL_MS) return false;
					}
					tailEnums[tailConfigIdx] = null;
					tailConfigIdx++;
				}
				return true;
			}

			// Filler stage: emit only combos that contain >=1 filler material.
			// The initial scan already emits the top-scoring few into the result
			// table, so dedup against emittedKeys to avoid re-emitting those.
			function runFillerBatch(batchSize) {
				var batchEmitted = 0;
				while (fillerConfigIdx < configs.length) {
					if (shouldCancel && shouldCancel()) return true;
					var fctx = configs[fillerConfigIdx];
					if (!fctx || !fctx.cfgE) { fillerConfigIdx++; continue; }

					var fcfg = fctx.cfgE;
					var fGT = fctx.gizmoType;
					var fAnc = fctx.ancient;
					var fMats = fcfg.matsArr;
					var fIsContrib = fcfg.isContributorIdx;
					var fSlots = fcfg.slots;
					var fPrefix = fGT + '|' + (fAnc ? 'A' : 'R') + '|F|';
					var fEnum = fillerEnums[fillerConfigIdx];
					if (!fEnum) {
						fEnum = createBoundedEnumerator(fcfg, maxDistinctMats);
						fillerEnums[fillerConfigIdx] = fEnum;
					}

					while (true) {
						if (shouldCancel && shouldCancel()) return true;
						var comboIdx = fEnum.next();
						if (comboIdx === null) break;
						var hasFiller = false;
						for (var fi = 0; fi < fSlots; fi++) {
							if (!fIsContrib[comboIdx[fi]]) { hasFiller = true; break; }
						}
						if (!hasFiller) continue;
						if (emittedKeys[fPrefix + comboIdx.join(',')]) continue;
						emitRow(indicesToNames(comboIdx, fMats), fGT, fAnc);
						evaluatedSoFar++;
						batchEmitted++;
						if (onProgress && evaluatedSoFar % 10 === 0) {
							onProgress({ phase: 'evaluating', current: evaluatedSoFar, total: grandTotalCandidates });
						}
						if (batchEmitted >= batchSize || Date.now() - batchStartMs >= PAUSE_INTERVAL_MS) return false;
					}
					fillerEnums[fillerConfigIdx] = null;
					fillerConfigIdx++;
				}
				return true;
			}

			function advanceTail(batchSize) {
				batchStartMs = Date.now(); 
				if (tailStage === 'restricted') {
					if (!runTailBatch(batchSize)) return false; // budget/ceiling hit
					if (!anyFillerConfig) return true;          // fully done
					tailStage = 'filler';                       // fall through, no forced pause
				}
				return runFillerBatch(batchSize);               // true = done, false = pause
			}

			tailDone = advanceTail(TAIL_INITIAL_BUFFER);

			if (tailDone && onProgress && grandTotal > 0) {
				onProgress({ phase: 'evaluating', current: evaluatedSoFar, total: grandTotalCandidates });
			}

			// Session return for the scoreFn path. The worker reads
			// tailDone and calls continueTail() to drive subsequent batches.
			return {
				allResults: allResults || [],
				tailDone: tailDone,
				continueTail: function () {
					if (tailDone) return true;
					if (shouldCancel && shouldCancel()) { tailDone = true; return true; }
					tailDone = advanceTail(TAIL_BATCH_SIZE);
					if (tailDone && onProgress) {
						onProgress({ phase: 'evaluating', current: evaluatedSoFar, total: grandTotalCandidates });
					}
					return tailDone;
				}
			};
		} else {
			// When caller doesn't care about ordering, e.g.: headless tests.
			// Restricted pool (no filler) -- this path enumerates EVERY
			// covering combo with no top-K bound, so filler expansion would
			// blow it up with no benefit to its callers (which validate
			// specific contributor recipes against the oracle).
			for (var g2 = 0; g2 < gizmoTypes.length; g2++) {
				for (var am2 = 0; am2 < ancientModes.length; am2++) {
					if (shouldCancel && shouldCancel()) return allResults || [];
					var gizmoType2 = gizmoTypes[g2];
					var ancient2 = ancientModes[am2];
					var cfg2 = buildConfig(gizmoType2, ancient2, false);
					if (!cfg2) continue;
					var contributorSets2 = cfg2.contributorSets;
					enumerateCombos(cfg2.matsArr, cfg2.slots, maxDistinctMats, function (combo) {
						if (!comboCoversRequired(combo, contributorSets2)) return true;
						if (shouldCancel && shouldCancel()) return false;
						emitRow(combo, gizmoType2, ancient2);
						return true;
					}, shouldCancel);
				}
			}
		}

		return allResults || [];
	}

	return {
		search: search,
		parseResultKey: parseResultKey,
		keyMatches: keyMatches,
		enumerateCombos: enumerateCombos,
		createMultisetEnumerator: createMultisetEnumerator,
		comboOrderSensitive: comboOrderSensitive,
		targetsCanTie: targetsCanTie
	};
}
// </nowiki>