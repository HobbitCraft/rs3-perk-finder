// Local multi-core coordinator for the RuneScape Wiki perk finder worker.
//
// The upstream worker remains the search oracle. This coordinator creates one
// child per logical CPU and gives each child a disjoint hashed multiset slice
// via the local shardIndex/shardCount/shardDepth extension.

'use strict';

var hardwareThreads = (self.navigator && self.navigator.hardwareConcurrency) || 4;
var workerCount = Math.max(1, Math.min(64, hardwareThreads));
var childUrl = 'perkfinder-worker-sharded.js';
var children = [];
var states = [];
var initialized = false;
var initReady = 0;
var searchActive = false;
var terminalSent = false;
var enumeratedSent = false;
var lastProgressAt = 0;
var searchStartedAt = 0;
var pendingRows = [];
var rowFlushTimer = null;
var RESULT_BATCH_SIZE = 128;

function flushRows() {
	if (rowFlushTimer !== null) {
		clearTimeout(rowFlushTimer);
		rowFlushTimer = null;
	}
	if (pendingRows.length === 0) return;
	var rows = pendingRows;
	pendingRows = [];
	self.postMessage({ type: 'result-batch', rows: rows });
}

function queueRow(row) {
	pendingRows.push(row);
	if (pendingRows.length >= RESULT_BATCH_SIZE) {
		flushRows();
	} else if (rowFlushTimer === null) {
		rowFlushTimer = setTimeout(flushRows, 16);
	}
}

function postPoolInfo() {
	self.postMessage({
		type: 'pool-info',
		workers: workerCount,
		hardwareThreads: hardwareThreads
	});
}

function terminateChildren() {
	for (var i = 0; i < children.length; i++) {
		try { children[i].terminate(); } catch (e) {}
	}
	children = [];
	states = [];
}

function fail(message) {
	if (terminalSent) return;
	terminalSent = true;
	searchActive = false;
	flushRows();
	terminateChildren();
	self.postMessage({ type: 'error', message: message });
}

function allSettledForTail() {
	for (var i = 0; i < states.length; i++) {
		if (states[i].status !== 'paused' && states[i].status !== 'done') return false;
	}
	return true;
}

function everyDone() {
	for (var i = 0; i < states.length; i++) {
		if (states[i].status !== 'done') return false;
	}
	return true;
}

function emitTerminalOrPause() {
	if (!searchActive || terminalSent || !allSettledForTail()) return;
	if (everyDone()) {
		flushRows();
		terminalSent = true;
		searchActive = false;
		self.postMessage({ type: 'done', timestamp: Date.now() });
		return;
	}
	flushRows();
	self.postMessage({
		type: 'tail-paused',
		timestamp: Date.now(),
		workers: workerCount
	});
}

function emitProgress(force) {
	var now = Date.now();
	if (!force && now - lastProgressAt < 120) return;
	lastProgressAt = now;

	var allEnumerated = true;
	var enumerated = 0;
	var candidateTotal = 0;
	var evaluated = 0;
	var evaluationTotal = 0;
	var logicalTotal = 0;

	for (var i = 0; i < states.length; i++) {
		var state = states[i];
		if (!state.enumerationDone) allEnumerated = false;
		enumerated += state.enumerated || 0;
		candidateTotal += state.candidateTotal || 0;
		evaluated += state.evaluated || 0;
		evaluationTotal += state.evaluationTotal || 0;
		logicalTotal = Math.max(logicalTotal, state.logicalTotal || 0);
	}

	if (!allEnumerated) {
		self.postMessage({
			type: 'progress',
			data: {
				phase: 'enumerating',
				enumerated: enumerated,
				totalCandidates: candidateTotal,
				logicalTotalCandidates: logicalTotal,
				workers: workerCount
			}
		});
		return;
	}

	var bulkResolved = Math.max(0, logicalTotal - evaluationTotal);
	var logicalResolved = Math.min(logicalTotal, bulkResolved + evaluated);
	var elapsedSeconds = Math.max(0.001, (now - searchStartedAt) / 1000);
	var recipesPerSecond = logicalResolved / elapsedSeconds;

	if (!enumeratedSent) {
		enumeratedSent = true;
		self.postMessage({
			type: 'progress',
			data: {
				phase: 'enumerated',
				total: evaluationTotal,
				logicalTotalCandidates: logicalTotal,
				bulkResolved: bulkResolved,
				logicalResolved: logicalResolved,
				recipesPerSecond: recipesPerSecond,
				workers: workerCount
			}
		});
	}

	self.postMessage({
		type: 'progress',
		data: {
			phase: 'evaluating',
			current: evaluated,
			total: evaluationTotal,
			logicalTotalCandidates: logicalTotal,
			bulkResolved: bulkResolved,
			logicalResolved: logicalResolved,
			recipesPerSecond: recipesPerSecond,
			workers: workerCount
		}
	});
}

function handleChildMessage(index, event) {
	var msg = event.data || {};
	var state = states[index];

	if (!initialized) {
		if (msg.type === 'ready') {
			initReady++;
			if (initReady === workerCount) {
				initialized = true;
				self.postMessage({ type: 'ready', workers: workerCount });
				postPoolInfo();
			}
		} else if (msg.type === 'error') {
			fail('Worker ' + (index + 1) + ' failed to initialize: ' + msg.message);
		}
		return;
	}

	if (msg.type === 'started') return;
	if (msg.type === 'result') {
		queueRow(msg.row);
		return;
	}
	if (msg.type === 'subprogress') {
		msg.data = msg.data || {};
		msg.data.worker = index + 1;
		msg.data.workers = workerCount;
		self.postMessage(msg);
		return;
	}
	if (msg.type === 'progress') {
		var data = msg.data || {};
		if (data.phase === 'enumerating') {
			state.enumerated = data.enumerated || 0;
			state.candidateTotal = data.totalCandidates || state.candidateTotal || 0;
			state.logicalTotal = data.logicalTotalCandidates || state.logicalTotal || 0;
		} else if (data.phase === 'enumerated') {
			state.enumerationDone = true;
			state.enumerated = state.candidateTotal;
			state.evaluationTotal = data.total || 0;
			state.logicalTotal = data.logicalTotalCandidates || state.logicalTotal || 0;
		} else if (data.phase === 'evaluating') {
			state.evaluated = data.current || 0;
			if (data.total != null) state.evaluationTotal = data.total;
		}
		emitProgress(false);
		return;
	}
	if (msg.type === 'tail-paused') {
		state.status = 'paused';
		flushRows();
		emitProgress(true);
		emitTerminalOrPause();
		return;
	}
	if (msg.type === 'done') {
		state.status = 'done';
		flushRows();
		emitProgress(true);
		emitTerminalOrPause();
		return;
	}
	if (msg.type === 'cancelled') {
		state.status = 'done';
		emitTerminalOrPause();
		return;
	}
	if (msg.type === 'error') {
		fail('Worker ' + (index + 1) + ': ' + msg.message);
	}
}

function createPool(data) {
	flushRows();
	terminateChildren();
	initialized = false;
	initReady = 0;
	terminalSent = false;
	for (var i = 0; i < workerCount; i++) {
		var child = new Worker(childUrl, { name: 'perk-finder-' + (i + 1) });
		children.push(child);
		states.push({ status: 'idle' });
		(function (index, worker) {
			worker.addEventListener('message', function (event) {
				handleChildMessage(index, event);
			});
			worker.addEventListener('error', function (event) {
				fail('Worker ' + (index + 1) + ' runtime error: ' + (event.message || 'unknown error'));
			});
		}(i, child));
		child.postMessage({ type: 'init', sources: { data: data } });
	}
}

function beginSearch(params) {
	if (!initialized) {
		fail('The worker pool is not initialized.');
		return;
	}
	if (searchActive) {
		self.postMessage({ type: 'error', message: 'A search is already running.' });
		return;
	}
	searchActive = true;
	searchStartedAt = Date.now();
	terminalSent = false;
	enumeratedSent = false;
	lastProgressAt = 0;
	pendingRows = [];
	// A focused two-perk search has very few viable root materials, so root
	// sharding strands most CPUs. Hash the complete 5/9-slot multiset instead;
	// enumeration is cheap compared with the exact probability evaluation and
	// every expensive recipe is still owned by exactly one child.
	var focusedPair = params.targets && params.targets.length === 2 &&
		params.gizmoTypes && params.gizmoTypes.length === 1 &&
		params.ancientModes && params.ancientModes.length === 1;
	var shardDepth = focusedPair ? (params.ancientModes[0] ? 9 : 5) : 1;
	self.postMessage({
		type: 'started',
		timestamp: Date.now(),
		workers: workerCount,
		shardDepth: shardDepth
	});
	for (var i = 0; i < children.length; i++) {
		states[i] = {
			status: 'running',
			enumerationDone: false,
			enumerated: 0,
			candidateTotal: 0,
			evaluated: 0,
			evaluationTotal: 0,
			logicalTotal: 0
		};
		var childParams = Object.assign({}, params, {
			shardIndex: i,
			shardCount: workerCount,
			shardDepth: shardDepth
		});
		children[i].postMessage({ type: 'search', params: childParams });
	}
}

self.onmessage = function (event) {
	var msg = event.data || {};
	if (msg.type === 'init') {
		if (initialized) {
			self.postMessage({ type: 'ready', workers: workerCount });
			postPoolInfo();
			return;
		}
		createPool(msg.sources && msg.sources.data);
	} else if (msg.type === 'search') {
		beginSearch(msg.params || {});
	} else if (msg.type === 'continue-tail') {
		for (var i = 0; i < children.length; i++) {
			if (states[i].status === 'paused') {
				states[i].status = 'running';
				children[i].postMessage({ type: 'continue-tail' });
			}
		}
	} else if (msg.type === 'cancel') {
		for (var j = 0; j < children.length; j++) {
			children[j].postMessage({ type: 'cancel' });
		}
	}
};
