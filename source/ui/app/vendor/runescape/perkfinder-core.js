// <nowiki>
// Inverse-perk-search UI gadget
//
// Depends on:
//   ext.gadget.perkcalc-core   (provides window.rsPerkCalc.getMaterialsProb,
//                               plus the .perkCalcPotion / .perkCalcShell CSS
//                               used for the option icons below, and the
//                               getAttemptCost / makeCostCell helpers used
//                               by the Expected cost column)
//   ext.gadget.perkcalc-data   (provides window.rsPerks)
//   ext.gadget.rsw-util
//
// The heavy search runs in a Web Worker (Gadget-perkfinder-worker.js); the
// main thread just owns the form UI, spawns the worker, and streams result
// rows into the table as they arrive.

;(function ($, mw, rs) {
	// Two sentinels at the top of the perk2 dropdown:
	var ANY_PERK2   = '(ANY) Warning: May take a long time to search!';
	var EMPTY_PERK2 = '(EMPTY)';

	var self = {
		
		comps: [
			// DO NOT CHANGE IDS
			// these are used to construct short permalinks
			// changing an id will change the links that use it
			// just add new mats to the end
			// cat: 0 common, 1 uncommon, 2 rare
			{ name: "Base parts", cat: 0, id:1 },
			{ name: "Blade parts", cat: 0, id:2 },
			{ name: "Clear parts", cat: 0, id:3 },
			{ name: "Connector parts", cat: 0, id:4 },
			{ name: "Cover parts", cat: 0, id:5 },
			{ name: "Crafted parts", cat: 0, id:6 },
			{ name: "Crystal parts", cat: 0, id: 7},
			{ name: "Deflecting parts", cat: 0, id:8 },
			{ name: "Delicate parts", cat: 0, id:9 },
			{ name: "Flexible parts", cat: 0, id:10 },
			{ name: "Head parts", cat: 0, id:11 },
			{ name: "Magic parts", cat: 0, id:12 },
			{ name: "Metallic parts", cat: 0, id:13 },
			{ name: "Organic parts", cat: 0, id:14 },
			{ name: "Padded parts", cat: 0, id:15 },
			{ name: "Plated parts", cat: 0, id:16 },
			{ name: "Simple parts", cat: 0, id:17 },
			{ name: "Smooth parts", cat: 0, id:18 },
			{ name: "Spiked parts", cat: 0, id:19 },
			{ name: "Spiritual parts", cat: 0, id:20 },
			{ name: "Stave parts", cat: 0, id:21 },
			{ name: "Tensile parts", cat: 0, id:22 },
			
			{ name: "Dextrous components", cat: 1, id:23 },
			{ name: "Direct components", cat: 1, id:24 },
			{ name: "Enhancing components", cat: 1, id:25 },
			{ name: "Ethereal components", cat: 1, id:26 },
			{ name: "Evasive components", cat: 1, id:27 },
			{ name: "Healthy components", cat: 1, id:28 },
			{ name: "Heavy components", cat: 1, id:29 },
			{ name: "Imbued components", cat: 1, id:30 },
			{ name: "Light components", cat: 1, id:31 },
			{ name: "Living components", cat: 1, id:32 },
			{ name: "Pious components", cat: 1, id:33 },
			{ name: "Powerful components", cat: 1, id:34 },
			{ name: "Precious components", cat: 1, id:35 },
			{ name: "Precise components", cat: 1, id:36 },
			{ name: "Protective components", cat: 1, id:37 },
			{ name: "Refined components", cat: 1, id:38 },
			{ name: "Sharp components", cat: 1, id:39 },
			{ name: "Strong components", cat: 1, id:40 },
			{ name: "Stunning components", cat: 1, id:41 },
			{ name: "Subtle components", cat: 1, id:42 },
			{ name: "Swift components", cat: 1, id:43 },
			{ name: "Variable components", cat: 1, id:44 },
			{ name: "Armadyl components", cat: 2, id:45 },
			{ name: "Ascended components", cat: 2, id:46 },
			{ name: "Avernic components", cat: 2, id:47 },
			{ name: "Bandos components", cat: 2, id:48 },
			{ name: "Brassican components", cat: 2, id:49 },
			{ name: "Clockwork components", cat: 2, id:50 },
			{ name: "Corporeal components", cat: 2, id:51 },
			{ name: "Culinary components", cat: 2, id:52 },
			{ name: "Cywir components", cat: 2, id:53 },
			{ name: "Dragonfire components", cat: 2, id:54 },
			{ name: "Explosive components", cat: 2, id:55 },
			{ name: "Faceted components", cat: 2, id:56 },
			{ name: "Fortunate components", cat: 2, id:57 },
			{ name: "Fungal components", cat: 2, id:58 },
			{ name: "Harnessed components", cat: 2, id:59 },
			{ name: "Ilujankan components", cat: 2, id:60 },
			{ name: "Knightly components", cat: 2, id:61 },
			{ name: "Noxious components", cat: 2, id:62 },
			{ name: "Oceanic components", cat: 2, id:63 },
			{ name: "Pestiferous components", cat: 2, id:64 },
			{ name: "Resilient components", cat: 2, id:65 },
			{ name: "Rumbling components", cat: 2, id:66 },
			{ name: "Saradomin components", cat: 2, id:67 },
			{ name: "Seren components", cat: 2, id:68 },
			{ name: "Shadow components", cat: 2, id:69 },
			{ name: "Shifting components", cat: 2, id:70 },
			{ name: "Silent components", cat: 2, id:71 },
			{ name: "Third-age components", cat: 2, id:72 },
			{ name: "Undead components", cat: 2, id:73 },
			{ name: "Zamorak components", cat: 2, id:74 },
			{ name: "Zaros components", cat: 2, id:75 },
			{ name: "Classic components", cat: 2, ancient: true, id:76 },
			{ name: "Historic components", cat: 2, ancient: true, id:77 },
			{ name: "Timeworn components", cat: 2, ancient: true, id:78 },
			{ name: "Vintage components", cat: 2, ancient: true, id:79 },
			{ name: "Offcut components", cat: 1, id: 80 },
			{ name: "Manufactured components", cat: 2, id: 81 },
			{ name: "Ecliptic components", cat: 2, id: 82 }
		],

		// DO NOT CHANGE IDS
		// plz just add new perks to the end.
		perkIds: [
			{ name: "Absorbative", id: 1 },
			{ name: "Aftershock", id: 2 },
			{ name: "Antitheism", id: 3 },
			{ name: "Biting", id: 4 },
			{ name: "Blunted", id: 5 },
			{ name: "Brassican", id: 6 },
			{ name: "Breakdown", id: 7 },
			{ name: "Brief Respite", id: 8 },
			{ name: "Bulwark", id: 9 },
			{ name: "Butterfingers", id: 10 },
			{ name: "Careless", id: 11 },
			{ name: "Caroming", id: 12 },
			{ name: "Cautious", id: 13 },
			{ name: "Charitable", id: 14 },
			{ name: "Cheapskate", id: 15 },
			{ name: "Clear Headed", id: 16 },
			{ name: "Committed", id: 17 },
			{ name: "Confused", id: 18 },
			{ name: "Crackling", id: 19 },
			{ name: "Crystal Shield", id: 20 },
			{ name: "Demon Bait", id: 21 },
			{ name: "Demon Slayer", id: 22 },
			{ name: "Devoted", id: 23 },
			{ name: "Dragon Bait", id: 24 },
			{ name: "Dragon Slayer", id: 25 },
			{ name: "Efficient", id: 26 },
			{ name: "Energising", id: 27 },
			{ name: "Enhanced Devoted", id: 28 },
			{ name: "Enhanced Efficient", id: 29 },
			{ name: "Enlightened", id: 30 },
			{ name: "Equilibrium", id: 31 },
			{ name: "Eruptive", id: 32 },
			{ name: "Explosive", id: 33 },
			{ name: "Fatiguing", id: 34 },
			{ name: "Flanking", id: 35 },
			{ name: "Fortune", id: 36 },
			{ name: "Furnace", id: 37 },
			{ name: "Genocidal", id: 38 },
			{ name: "Glow Worm", id: 39 },
			{ name: "Hallucinogenic", id: 40 },
			{ name: "Hasty", id: 41 },
			{ name: "Hoarding", id: 42 },
			{ name: "Honed", id: 43 },
			{ name: "Imp Souled", id: 44 },
			{ name: "Impatient", id: 45 },
			{ name: "Inaccurate", id: 46 },
			{ name: "Invigorating", id: 47 },
			{ name: "Junk Food", id: 48 },
			{ name: "Looting", id: 49 },
			{ name: "Lucky", id: 50 },
			{ name: "Lunging", id: 51 },
			{ name: "Mediocrity", id: 52 },
			{ name: "Mobile", id: 53 },
			{ name: "Mysterious", id: 54 },
			{ name: "Naturalist", id: 55 },
			{ name: "Oblivious", id: 56 },
			{ name: "Planted Feet", id: 57 },
			{ name: "Polishing", id: 58 },
			{ name: "Precise", id: 59 },
			{ name: "Preparation", id: 60 },
			{ name: "Preservationist", id: 61 },
			{ name: "Profane", id: 62 },
			{ name: "Prosper", id: 63 },
			{ name: "Pyromaniac", id: 64 },
			{ name: "Rapid", id: 65 },
			{ name: "Refined", id: 66 },
			{ name: "Reflexes", id: 67 },
			{ name: "Relentless", id: 68 },
			{ name: "Ruthless", id: 69 },
			{ name: "Scavenging", id: 70 },
			{ name: "Scraps", id: 71 },
			{ name: "Shield Bashing", id: 72 },
			{ name: "Spendthrift", id: 73 },
			{ name: "Talking", id: 74 },
			{ name: "Taunting", id: 75 },
			{ name: "Tinker", id: 76 },
			{ name: "Trophy-taker's", id: 77 },
			{ name: "Turtling", id: 78 },
			{ name: "Ultimatums", id: 79 },
			{ name: "Undead Bait", id: 80 },
			{ name: "Undead Slayer", id: 81 },
			{ name: "Venomblood", id: 82 },
			{ name: "Wild Runes", id: 83 },
			{ name: "Wise", id: 84 }
		],
		materialPrices: {},
		gizmoPrices: {},
		
		// Persistent worker. Lazily spawned on first search and reused across
		// subsequent searches to amortize the importScripts cost.
		worker: null,
		workerReady: false,
		// When a search is running, this is set to a function that does
		// hard-kill cleanup (terminate worker, remove handler, restore UI).
		// Stop and Reset both call it. Cleared when the search ends naturally.
		activeSearchCancel: null,

		// beforeunload handler installed while the output area holds
		// either an in-flight search or visible results.
		_beforeUnloadHandler: null,

		init: function () {
			var $finder = $('#perkFinder');
			if (!$finder.length) return;
			
			if (!window.rsPerks || !window.rsPerks.perks) {
				$finder.text('Error: perk data (rsPerks) not loaded.');
				return;
			}

			// Preload both jquery.tablesorter (the script) and
			// jquery.tablesorter.styles.
			mw.loader.load('jquery.tablesorter');
			mw.loader.load('jquery.tablesorter.styles');

			self.buildCompCategoryMap();

			self.build($finder);
		},

		// Walk perkcalc-core's `comps` array.
		// Falls back to an empty map if the perkcalc
		// gadget hasn't exposed its comps list.
		buildCompCategoryMap: function () {
			self._compCategoryMap = Object.create(null);
			var catNames = ['common', 'uncommon', 'rare'];
			var arr = self.comps;
			for (var i = 0; i < arr.length; i++) {
				var c = arr[i];
				if (!c || !c.name) continue;
				if (c.ancient === true) {
					self._compCategoryMap[c.name] = 'ancient';
				} else {
					self._compCategoryMap[c.name] = catNames[c.cat] || 'common';
				}
			}
		},

		// Return the rarity tier for a material.
		// Unrecognized names default to 'common'.
		getMatCategory: function (matName) {
			if (matName === '' || matName == null) return 'empty';
			return (self._compCategoryMap && self._compCategoryMap[matName]) || 'common';
		},

		build: function ($container) {
			var perkNames = Object.keys(window.rsPerks.perks)
				.filter(function (p) {
					var d = window.rsPerks.perks[p];
					return p !== 'No effect' && d && d.ranks && d.ranks.length > 0;
				})
				.sort();
			var perkOptions = perkNames.map(function (p) { return { data: p }; });
			self.snapshotPrices();

			var perk1 = new OO.ui.ComboBoxInputWidget({
				options: perkOptions,
				menu: { filterFromInput: true }
			});
			var rank1 = new OO.ui.ButtonSelectWidget();

			// Sentinel option objects for the perk2 dropdown. The strings
			// are hoisted to module scope so we can compare against the
			// same values without duplication.
			var anyPerk2Option   = { data: ANY_PERK2,   label: ANY_PERK2 };
			var emptyPerk2Option = { data: EMPTY_PERK2, label: EMPTY_PERK2 };

			var perk2 = new OO.ui.ComboBoxInputWidget({
				options: [anyPerk2Option, emptyPerk2Option].concat(perkOptions),
				menu: { filterFromInput: true },
				disabled: true,
				value: EMPTY_PERK2
			});
			var rank2 = new OO.ui.ButtonSelectWidget();

			// Perk blacklist, only when perk2 is (ANY).
			var perkBlacklist = new OO.ui.MenuTagMultiselectWidget({
				inputPosition: 'outline',
				allowArbitrary: false,
				allowReordering: false,
				options: [{ data: EMPTY_PERK2, label: '(EMPTY)' }]
					.concat(perkNames.map(function (p) { return { data: p, label: p }; })),
				placeholder: 'Perks to exclude from results'
			});

			var perksByGizmo = self.computePerksByGizmo(window.rsPerks);

			var levelInput = new OO.ui.NumberInputWidget({ min: 1, max: 120, value: 120 });

			var potionSelect = new OO.ui.ButtonSelectWidget({
				items: [
					new OO.ui.ButtonOptionWidget({
						data: 'none',
						label: new OO.ui.HtmlSnippet('<div class="perkCalcPotion" data-potion="none"></div> None')
					}),
					new OO.ui.ButtonOptionWidget({
						data: 'normal',
						label: new OO.ui.HtmlSnippet('<div class="perkCalcPotion" data-potion="normal"></div> Normal')
					}),
					new OO.ui.ButtonOptionWidget({
						data: 'super',
						label: new OO.ui.HtmlSnippet('<div class="perkCalcPotion" data-potion="super"></div> Super')
					}),
					new OO.ui.ButtonOptionWidget({
						data: 'extreme',
						label: new OO.ui.HtmlSnippet('<div class="perkCalcPotion" data-potion="extreme"></div> Extreme')
					})
				]
			});
			potionSelect.selectItemByData('extreme');

			var gizmoWeapon = new OO.ui.ToggleButtonWidget({
				label: new OO.ui.HtmlSnippet('<div class="perkCalcShell" data-shell="weapon"></div> Weapon'),
				value: true
			});
			var gizmoArmour = new OO.ui.ToggleButtonWidget({
				label: new OO.ui.HtmlSnippet('<div class="perkCalcShell" data-shell="armour"></div> Armour'),
				value: true
			});
			var gizmoTool = new OO.ui.ToggleButtonWidget({
				label: new OO.ui.HtmlSnippet('<div class="perkCalcShell" data-shell="tool"></div> Tool'),
				value: true
			});
			var gizmoTypesGroup = new OO.ui.ButtonGroupWidget({
				items: [gizmoWeapon, gizmoArmour, gizmoTool]
			});

			var variantRegular = new OO.ui.ToggleButtonWidget({ label: 'Regular', value: true });
			var variantAncient = new OO.ui.ToggleButtonWidget({ label: 'Ancient', value: true });
			var variantGroup = new OO.ui.ButtonGroupWidget({
				items: [variantRegular, variantAncient]
			});

			var maxDistinctInput = new OO.ui.NumberInputWidget({ min: 1, max: 9, value: 4 });

			// Advanced: ignore the costs of the selected component rarity tiers.
			var ignoreCommon = new OO.ui.ToggleButtonWidget({ label: 'Common', value: false });
			var ignoreUncommon = new OO.ui.ToggleButtonWidget({ label: 'Uncommon', value: false });
			var ignoreRare = new OO.ui.ToggleButtonWidget({ label: 'Rare', value: false });
			var ignoreAncient = new OO.ui.ToggleButtonWidget({ label: 'Ancient', value: false });
			var ignoreCostGroup = new OO.ui.ButtonGroupWidget({
				items: [ignoreCommon, ignoreUncommon, ignoreRare, ignoreAncient]
			});
			var alwaysRefinedSwitch = new OO.ui.ToggleSwitchWidget({ value: false });
			var ignoreGizmoSwitch = new OO.ui.ToggleSwitchWidget({ value: false });

			var submitBtn = new OO.ui.ButtonWidget({ label: 'Search', flags: ['primary', 'progressive'] });
			var resetBtn = new OO.ui.ButtonWidget({ label: 'Reset', flags: ['destructive'] });
			// only appears once a search is actually running.
			var stopBtn = new OO.ui.ButtonWidget({
				label: 'Stop',
				flags: ['primary', 'destructive'],
				classes: ['perkFinderStopBtn']
			});
			stopBtn.toggle(false);

			var permalinkBtn = new OO.ui.ButtonWidget({ label: 'Copy link to this setup' });

			var perk1Field = new OO.ui.FieldLayout(perk1, {
				label: 'Target perk 1', align: 'right'
			});
			var rank1Field = new OO.ui.FieldLayout(rank1, {
				label: 'Minimum rank', align: 'right'
			});
			var perk2Field = new OO.ui.FieldLayout(perk2, {
				label: 'Target perk 2', align: 'right',
				help: 'Automatically restricted to only perks that can coexist with perk 1.'
			});
			var rank2Field = new OO.ui.FieldLayout(rank2, {
				label: 'Minimum rank', align: 'right'
			});
			var blacklistField = new OO.ui.FieldLayout(perkBlacklist, {
				label: 'Perk blacklist', align: 'right',
				help: 'Result that contains any of the selected perks will not be counted.'
			});
			rank1Field.toggle(false);
			rank2Field.toggle(false);
			blacklistField.toggle(false);

			var fieldset = new OO.ui.FieldsetLayout({ classes: ['perkFinderFieldset'] });
			fieldset.addItems([
				perk1Field, rank1Field, perk2Field, rank2Field, blacklistField,
				new OO.ui.FieldLayout(levelInput, {
					label: 'Invention level', align: 'right'
				}),
				new OO.ui.FieldLayout(potionSelect, {
					label: new OO.ui.HtmlSnippet(
						'<a href="https://runescape.wiki/w/Invention#Temporary_boosts" target="_blank" rel="noopener">Invention potion</a>'
					),
					align: 'right'
				}),
				new OO.ui.FieldLayout(gizmoTypesGroup, {
					label: 'Gizmo types', align: 'right',
					help: 'Toggle the gizmo type to be included in the search. At least one must be selected.'
				}),
				new OO.ui.FieldLayout(variantGroup, {
					label: 'Gizmo variant', align: 'right',
					help: 'Toggle the gizmo variant to be included in the search. At least one must be selected.'
				})
			]);

			// Advanced options: collapsible, hidden by default.
			var maxDistinctField = new OO.ui.FieldLayout(maxDistinctInput, {
				label: 'Max distinct materials per combo', align: 'right',
				help: 'Most useful gizmo recipes use up to 4 distinct materials. Raising the cap exponentially slows the search. Set to 9 for exhaustive search on ancient gizmos.'
			});
			var ignoreGizmoField = new OO.ui.FieldLayout(ignoreGizmoSwitch, {
				label: 'Ignore gizmo costs', align: 'right',
				help: 'Ignore the gizmo shell cost in both the ranking and the expected cost.'
			});
			var ignoreCostField = new OO.ui.FieldLayout(ignoreCostGroup, {
				label: 'Ignore component costs', align: 'right',
				help: 'Ignores costs of selected component rarity tiers.'
			});
			var alwaysRefinedField = new OO.ui.FieldLayout(alwaysRefinedSwitch, {
				label: 'Always include Refined components costs', align: 'right',
				help: 'Force refined components costs to be included even if uncommon materials costs are ignored above.'
			});

			var advancedSwitch = new OO.ui.ToggleSwitchWidget({ value: false });
			var advancedToggleField = new OO.ui.FieldLayout(advancedSwitch, {
				label: 'Advanced options', align: 'right'
			});
			var advancedBox = new OO.ui.FieldsetLayout({ classes: ['perkFinderAdvancedBox'] });
			advancedBox.addItems([maxDistinctField, ignoreGizmoField, ignoreCostField, alwaysRefinedField]);
			advancedBox.toggle(false);
			advancedSwitch.on('change', function (v) { advancedBox.toggle(v); });
			var setAdvancedOpen = function (open) { advancedSwitch.setValue(open); };
			fieldset.addItems([advancedToggleField]);
			fieldset.$group.append(advancedBox.$element);

			var $buttonRow = $('<div class="perkFinderButtons">').append(
				submitBtn.$element, ' ', resetBtn.$element, ' ', permalinkBtn.$element, ' ', stopBtn.$element
			);

			stopBtn.$element.on('click', function () {
				if (stopBtn.isDisabled()) return;
				stopBtn.setDisabled(true);
				stopBtn.setLabel('Stopping...');
				if (self.activeSearchCancel) self.activeSearchCancel();
			});

			// "Copy link to this setup" button.
			permalinkBtn.$element.on('click', function () {
				// p1 (perk1), r1 (p1 rank), p2, r2, l (level),
				// p (potion), g (gizmo), v (variant/ancient), m (max distinct comp).
				// Settings at default value are omitted when generating link.
				// Links with empty / invalid args are treated as default.
				var qs = {};
				var p1 = (perk1.getValue() || '').trim();
				if (p1 && window.rsPerks.perks[p1]) {
					qs.p1 = self.perkToId(p1) || p1; // numeric id
					var p1d = window.rsPerks.perks[p1];
					var maxR1 = p1d.ranks[p1d.ranks.length - 1].rank;
					var r1 = rank1.findSelectedItem();
					if (r1 && r1.getData() !== maxR1) qs.r1 = r1.getData(); // default = max
					if (!p1d.doubleslot) {
						var p2 = (perk2.getValue() || '').trim();
						if (p2 === ANY_PERK2) {
							qs.p2 = 0; // 0 = (ANY); default = (EMPTY)
							// Export Blacklist to link.
							var blVals = perkBlacklist.getValue() || [];
							var blIds = [];
							for (var bvi = 0; bvi < blVals.length; bvi++) {
								if (blVals[bvi] === EMPTY_PERK2) blIds.push(0); // 0 = (EMPTY) for blacklist purposes
								else { var bid = self.perkToId(blVals[bvi]); if (bid) blIds.push(bid); }
							}
							if (blIds.length) qs.b = blIds.join(',');
						} else if (p2 && p2 !== EMPTY_PERK2 && p2 !== p1 && window.rsPerks.perks[p2]) {
							qs.p2 = self.perkToId(p2) || p2;
							var p2d = window.rsPerks.perks[p2];
							var maxR2 = p2d.ranks[p2d.ranks.length - 1].rank;
							var r2 = rank2.findSelectedItem();
							if (r2 && r2.getData() !== maxR2) qs.r2 = r2.getData();
						}
					}
				}
				var lvl = parseInt(levelInput.getValue(), 10) || 120;
				if (lvl !== 120) qs.l = lvl;
				var potCode = { none: 0, normal: 1, super: 2, extreme: 3 };
				var pot = potionSelect.findSelectedItem();
				var pc = pot ? potCode[pot.getData()] : 3;
				if (pc !== 3) qs.p = pc;
				var gw = gizmoWeapon.getValue(), ga = gizmoArmour.getValue(), gt = gizmoTool.getValue();
				if (!(gw && ga && gt)) {
					var g = [];
					if (gw) g.push(1);
					if (ga) g.push(2);
					if (gt) g.push(3);
					qs.g = g.join(',');
				}
				var vReg = variantRegular.getValue(), vAnc = variantAncient.getValue();
				if (!(vReg && vAnc)) {
					var v = [];
					if (vReg) v.push(0);
					if (vAnc) v.push(1);
					qs.v = v.join(',');
				}
				var md = parseInt(maxDistinctInput.getValue(), 10) || 4;
				if (md !== 4) qs.m = md;

				var uri = self.makeQueryFragment(qs);
				var txt = document.createElement('textarea'), $txt = $(txt);
				$txt.val(uri.toString()).css({
					position: 'fixed', top: 0, left: 0, width: '2em', height: '2em',
					padding: 0, border: 'none', outline: 'none', boxShadow: 'none', background: 'transparent'
				}).appendTo('body');
				txt.select();
				try {
					document.execCommand('copy');
					mw.notify('Copied permalink to the clipboard', { tag: 'perkFinderCopyLink' });
				} catch (err) {}
				$txt.remove();
			});

			var $result = $('<div id="perkCalcResult" class="tile">').text('Submit the form to search for material combinations.');

			$container.empty().append(fieldset.$element, $buttonRow, $result);

			function updatePerk2Options() {
				var name = (perk1.getValue() || '').trim();
				var perkData = name ? window.rsPerks.perks[name] : null;
				if (!perkData || perkData.doubleslot) return;

				var compatible = self.getCompatiblePerks(name, perksByGizmo, window.rsPerks);
				var allowedSet = {};
				compatible.forEach(function (p) { allowedSet[p] = true; });
				var newOptions = compatible.map(function (p) { return { data: p }; });

				var currentP2 = (perk2.getValue() || '').trim();
				perk2.setOptions([anyPerk2Option, emptyPerk2Option].concat(newOptions));
				if ((perk2.getValue() || '').trim() !== currentP2) {
					perk2.setValue(currentP2 || EMPTY_PERK2);
				}
				if (currentP2 && currentP2 !== ANY_PERK2 && currentP2 !== EMPTY_PERK2 &&
					!allowedSet[currentP2]) {
					perk2.setValue(EMPTY_PERK2);
				}
			}

			function updateBlacklistVisibility() {
				var p1 = (perk1.getValue() || '').trim();
				var p2 = (perk2.getValue() || '').trim();
				blacklistField.toggle(!!(p1 && window.rsPerks.perks[p1]) && p2 === ANY_PERK2);
			}

			// Suppress the dependent-UI cascade while clear-on-focus to prevent churn on focus.
			var suppressPerk1Change = false, suppressPerk2Change = false;
			perk1.on('change', function (value) {
				if (suppressPerk1Change) return;
				var name = (value || '').trim();
				var perkData = name ? window.rsPerks.perks[name] : null;
				if (!perkData) {
					rank1Field.toggle(false);
					perk2.setDisabled(true);
					perk2Field.setNotices([]);
					rank2Field.toggle(false);
					updateBlacklistVisibility();
					return;
				}
				self.populateRankSelect(rank1, perkData);
				rank1Field.toggle(true);

				if (perkData.doubleslot) {
					// A doubleslot perk1 ignores perk2
					perk2.setValue(EMPTY_PERK2);
					perk2.setDisabled(true);
					rank2Field.toggle(false);
					perk2Field.setNotices([
						new OO.ui.HtmlSnippet('<i>' + mw.html.escape(name) + ' is a doubleslot perk and cannot be paired with another perk.</i>')
					]);
				} else {
					perk2.setDisabled(false);
					perk2Field.setNotices([]);
					// resets perk2 to (EMPTY) only when the prior
					// selection is no longer compatible. otherwise
					// leave intact.
					updatePerk2Options();
					// First-time perk1 selection: perk2 starts disabled
					if (!(perk2.getValue() || '').trim()) {
						perk2.setValue(EMPTY_PERK2);
					}
					var p2Now = (perk2.getValue() || '').trim();
					if (p2Now && p2Now !== ANY_PERK2 && p2Now !== EMPTY_PERK2) {
						rank2Field.toggle(true);
					}
				}
			});

			perk2.on('change', function (value) {
				if (suppressPerk2Change) return;
				var name = (value || '').trim();
				updateBlacklistVisibility();
				// (ANY) and (EMPTY) are not real perks, i.e. no rank.
				if (name === ANY_PERK2 || name === EMPTY_PERK2) {
					rank2Field.toggle(false);
					return;
				}
				var perkData = name ? window.rsPerks.perks[name] : null;
				if (!perkData) {
					rank2Field.toggle(false);
					return;
				}
				self.populateRankSelect(rank2, perkData);
				rank2Field.toggle(true);
			});

			// Clear the perk field on focus.
			// If user leaves without entering anything, restore prior value.
			function attachClearOnFocus(widget, setSuppress) {
				var prevValue = null;
				widget.$input.on('focus', function () {
					if (widget.isDisabled()) return;
					prevValue = widget.getValue();
					if (prevValue === '') { prevValue = null; return; }
					setSuppress(true);
					widget.setValue('');
					setSuppress(false);
				});
				widget.$input.on('blur', function () {
					var saved = prevValue;
					prevValue = null;
					if (saved !== null && (widget.getValue() || '') === '') {
						widget.setValue(saved);
					}
				});
			}
			attachClearOnFocus(perk1, function (v) { suppressPerk1Change = v; });
			attachClearOnFocus(perk2, function (v) { suppressPerk2Change = v; });

			submitBtn.$element.on('click', function () {
				if (submitBtn.isDisabled()) return;
				self.runSearch({
					perk1: perk1, rank1: rank1, perk2: perk2, rank2: rank2,
					level: levelInput, potion: potionSelect,
					weapon: gizmoWeapon, armour: gizmoArmour, tool: gizmoTool,
					variantRegular: variantRegular, variantAncient: variantAncient,
					maxDistinct: maxDistinctInput,
					ignoreCommon: ignoreCommon, ignoreUncommon: ignoreUncommon,
					ignoreRare: ignoreRare, ignoreAncient: ignoreAncient,
					alwaysRefined: alwaysRefinedSwitch,
					ignoreGizmo: ignoreGizmoSwitch,
					blacklist: perkBlacklist,
					submitBtn: submitBtn,
					stopBtn: stopBtn
				});
			});

			resetBtn.$element.on('click', function () {
				// Reset also acts as a force-kill for the worker
				if (self.activeSearchCancel) self.activeSearchCancel();
				perk1.setValue('');
				perk2.setValue(EMPTY_PERK2);
				levelInput.setValue(120);
				potionSelect.selectItemByData('extreme');
				gizmoWeapon.setValue(true);
				gizmoArmour.setValue(true);
				gizmoTool.setValue(true);
				variantRegular.setValue(true);
				variantAncient.setValue(true);
				maxDistinctInput.setValue(4);
				ignoreCommon.setValue(false);
				ignoreUncommon.setValue(false);
				ignoreRare.setValue(false);
				ignoreAncient.setValue(false);
				alwaysRefinedSwitch.setValue(false);
				ignoreGizmoSwitch.setValue(false);
				perkBlacklist.clearItems();
				$result.empty().text('Submit the form to search for material combinations.');
				self.setWarnOnUnload(false);
			});

			// Handle query params in URI hash: prefills form and auto start.
			//  E.g. #p1=59&r1=3&p2=31&r2=1&l=120&p=3&g=1,2,3&v=0,1&m=4
			// Missing / invalid args fall back to default.
			try {
				var qs = self.parseQueryFragment(new mw.Uri()),
					uri = self.makeQueryFragment(qs);
				if (uri.toString() !== window.location.toString()) {
					window.history.replaceState(window.history.state, '', uri.toString());
				}
				// numeric perk id / name.
				var p1name = qs.p1 ? (self.idToPerk(parseInt(qs.p1, 10)) ||
					(/^\d+$/.test(String(qs.p1)) ? null : String(qs.p1))) : null;
				if (p1name && window.rsPerks.perks[p1name]) {
					// perk1 before rank1, likewise perk2 before rank2.
					perk1.setValue(p1name);
					if (qs.r1) rank1.selectItemByData(parseInt(qs.r1, 10));
					var p1d = window.rsPerks.perks[p1name];
					if (!(p1d && p1d.doubleslot) && qs.p2 != null && qs.p2 !== '') {
						if (String(qs.p2) === '0') {
							perk2.setValue(ANY_PERK2);
							// Import Blacklist from link.
							if (qs.b) {
								var blSel = [];
								String(qs.b).split(',').forEach(function (t) {
									var id = parseInt(t, 10);
									if (id === 0) blSel.push(EMPTY_PERK2); // 0 = (EMPTY) for blacklist purposes
									else { var nm = self.idToPerk(id); if (nm) blSel.push(nm); }
								});
								if (blSel.length) perkBlacklist.setValue(blSel);
							}
						} else {
							var p2name = self.idToPerk(parseInt(qs.p2, 10)) ||
								(/^\d+$/.test(String(qs.p2)) ? null : String(qs.p2));
							if (p2name && window.rsPerks.perks[p2name]) {
								perk2.setValue(p2name);
								if (qs.r2) rank2.selectItemByData(parseInt(qs.r2, 10));
							}
						}
					}
					if (qs.l) levelInput.setValue(parseInt(qs.l, 10));
					if (qs.p != null && qs.p !== '') {
						var potName = { '0': 'none', '1': 'normal', '2': 'super', '3': 'extreme' }[String(qs.p)];
						if (potName) potionSelect.selectItemByData(potName);
					}
					if (qs.g) {
						var g = String(qs.g).split(',');
						gizmoWeapon.setValue(g.indexOf('1') >= 0);
						gizmoArmour.setValue(g.indexOf('2') >= 0);
						gizmoTool.setValue(g.indexOf('3') >= 0);
					}
					if (qs.v) {
						var v = String(qs.v).split(',');
						variantRegular.setValue(v.indexOf('0') >= 0);
						variantAncient.setValue(v.indexOf('1') >= 0);
					}
					if (qs.m) { maxDistinctInput.setValue(parseInt(qs.m, 10)); setAdvancedOpen(true); }
					submitBtn.$element.click();
				}
			} catch (err) {
				if (window.console) window.console.error(err);
				mw.notify('Error loading linked settings', { tag: 'perkFinderCopyLink' });
			}
		},

		// URI params
		// E.g. #p1=59&r1=3&p2=31&r2=1&l=120&p=3&g=1,2,3&v=0,1&m=4
		// p1/p2 = perk ids | p2=0 = (ANY); p = potion 0-3;
		// g = gizmo (1: weapon, 2: armour, 3: tool); v = variant (0: regular,
		// 1: ancient)
		// Only p1 is required; everything else falls back to defaults
		
		perkIdMaps: null,
		buildPerkIdMaps: function () {
			if (self.perkIdMaps) return self.perkIdMaps;
			var n2i = Object.create(null), i2n = Object.create(null);
			for (var i = 0; i < self.perkIds.length; i++) {
				n2i[self.perkIds[i].name] = self.perkIds[i].id;
				i2n[self.perkIds[i].id] = self.perkIds[i].name;
			}
			self.perkIdMaps = { nameToId: n2i, idToName: i2n };
			return self.perkIdMaps;
		},
		perkToId: function (name) { return self.buildPerkIdMaps().nameToId[name]; },
		idToPerk: function (id) { return self.buildPerkIdMaps().idToName[id]; },

		makeQueryFragment: function (query) {
			var uri = new mw.Uri();
			uri.query = query;
			var uri2 = new mw.Uri();
			uri2.fragment = uri.getQueryString();
			return uri2;
		},

		parseQueryFragment: function (uri) {
			var qs = uri.query;
			if (typeof uri.fragment === 'string' && uri.fragment) {
				try {
					var uri2 = new mw.Uri(uri.path + '?' + uri.fragment);
					qs = $.extend({}, uri.query, uri2.query);
				} catch (e) { /* malformed fragment -> fall back to real query */ }
			}
			return qs || {};
		},

		// === Worker ===

		resolveWorkerConfig: function () {
			var cfg = window.PerkFinderConfig || {};
			var defaultRaw = function (page) {
				const url = mw.util.getUrl(page);
				return url+'?action=raw&ctype=text/javascript';
			};
			return {
				workerUrl: cfg.workerUrl || defaultRaw('MediaWiki:Gadget-perkfinder-worker.js'),
				importUrls: cfg.importUrls || {
					core: defaultRaw('MediaWiki:Gadget-perkcalc-core.js')
				}
			};
		},

		getOrCreateWorker: async function () {
			if (self.worker && self.workerReady) {
				return self.worker;
			}
			if (self.worker) {
				try { self.worker.terminate(); } catch (e) {}
				self.worker = null;
				self.workerReady = false;
			}
			var cfg = self.resolveWorkerConfig();
			var worker_ready_resolve = ()=>{}, worker_ready_promise = new Promise(res=>{worker_ready_resolve=res});
			var w;
			try {
				w = new Worker(cfg.workerUrl);
			} catch (err) {
				throw new Error('Failed to spawn worker: ' + err.message);
			}

			var initHandler = function (e) {
				var msg = e.data || {};
				if (msg.type === 'ready') {
					w.removeEventListener('message', initHandler);
					w.removeEventListener('error', errorHandler);
					self.worker = w;
					self.workerReady = true;
					worker_ready_resolve(w);
				} else if (msg.type === 'error') {
					w.removeEventListener('message', initHandler);
					w.removeEventListener('error', errorHandler);
					try { w.terminate(); } catch (e2) {}
					throw new Error(msg.message);
				}
			};
			var errorHandler = function (ev) {
				w.removeEventListener('message', initHandler);
				w.removeEventListener('error', errorHandler);
				try { w.terminate(); } catch (e2) {}
				var detail = ev.message || (ev.filename ? ev.filename + ':' + ev.lineno : '');
				throw new Error('Worker runtime error' +
					(detail ? ': ' + detail : ' (no details; check browser console for the underlying ErrorEvent)'));
			};
			w.addEventListener('message', initHandler);
			w.addEventListener('error', errorHandler);
			w.postMessage({
				type: 'init',
				sources: { data: window.rsPerks }
			});
			await worker_ready_promise;

			return w;
		},

		resetWorker: function () {
			if (window.PerkFinderConfig && window.PerkFinderConfig.native) {
				fetch('/api/cancel', { method: 'POST' }).catch(function () {});
			}
			if (self.worker) {
				try { self.worker.terminate(); } catch (e) {}
			}
			self.worker = null;
			self.workerReady = false;
		},

		// beforeunload handler for "Leave site?" confirmation.
		// Active whenever the output area has in-flight or visible work.
		setWarnOnUnload: function (enabled) {
			if (enabled) {
				if (self._beforeUnloadHandler) return;
				self._beforeUnloadHandler = function (e) {
					e.preventDefault();
					e.returnValue = '';
					return '';
				};
				window.addEventListener('beforeunload', self._beforeUnloadHandler);
			} else {
				if (!self._beforeUnloadHandler) return;
				window.removeEventListener('beforeunload', self._beforeUnloadHandler);
				self._beforeUnloadHandler = null;
			}
		},

		// === Search ===

		gatherSearchParams: function (widgets, $result) {
			var targets = [];
			var p1Name = (widgets.perk1.getValue() || '').trim();
			if (p1Name) {
				var r1Item = widgets.rank1.findSelectedItem();
				targets.push({ name: p1Name, minRank: r1Item ? r1Item.getData() : 1 });
			}
			var p2Name = (widgets.perk2.getValue() || '').trim();
			// Doubleslot perks in perk1 ignors perk2
			var p1Data = p1Name ? window.rsPerks.perks[p1Name] : null;
			var perk1IsDoubleslot = !!(p1Data && p1Data.doubleslot);
			// perk2:
			//   EMPTY_PERK2 -> perk1 + nothing
			//   ANY_PERK2 or '' -> perk1 + anything
			var requireExactCount = false;
			if (!perk1IsDoubleslot) {
				if (p2Name === EMPTY_PERK2) {
					requireExactCount = true;
				} else if (p2Name && p2Name !== ANY_PERK2 && p2Name !== p1Name) {
					var r2Item = widgets.rank2.findSelectedItem();
					targets.push({ name: p2Name, minRank: r2Item ? r2Item.getData() : 1 });
				}
				if (requireExactCount) {
					targets.exactCount = true;
				}
			}

			if (targets.length === 0) {
				$result.empty().append($('<div class="errorbox">').text('Please select at least one target perk.'));
				return null;
			}
			for (var t = 0; t < targets.length; t++) {
				if (!window.rsPerks.perks[targets[t].name]) {
					$result.empty().append($('<div class="errorbox">').text('Unknown perk: ' + targets[t].name));
					return null;
				}
			}

			var gizmoTypes = [];
			if (widgets.weapon.getValue()) gizmoTypes.push('weapon');
			if (widgets.armour.getValue()) gizmoTypes.push('armour');
			if (widgets.tool.getValue())   gizmoTypes.push('tool');
			if (gizmoTypes.length === 0) {
				$result.empty().append($('<div class="errorbox">').text('Please select a gizmo type.'));
				return null;
			}

			var ancientModes = [];
			if (widgets.variantRegular.getValue()) ancientModes.push(false);
			if (widgets.variantAncient.getValue()) ancientModes.push(true);
			if (ancientModes.length === 0) {
				$result.empty().append($('<div class="errorbox">').text('Please select a gizmo variant.'));
				return null;
			}

			var baseLevel = parseInt(widgets.level.getValue(), 10) || 120;
			var potItem = widgets.potion.findSelectedItem();
			var potion = potItem ? potItem.getData() : 'none';
			var effectiveLevel;
			switch (potion) {
				case 'normal':  effectiveLevel = baseLevel + 3; break;
				case 'super':   effectiveLevel = baseLevel + 5; break;
				case 'extreme': effectiveLevel = baseLevel + self.extremeInventionPotion(baseLevel); break;
				default:        effectiveLevel = baseLevel;
			}

			var maxDistinct = parseInt(widgets.maxDistinct.getValue(), 10) || 4;

			var ignoreTiers = Object.create(null);
			if (widgets.ignoreCommon && widgets.ignoreCommon.getValue()) ignoreTiers.common = true;
			if (widgets.ignoreUncommon && widgets.ignoreUncommon.getValue()) ignoreTiers.uncommon = true;
			if (widgets.ignoreRare && widgets.ignoreRare.getValue()) ignoreTiers.rare = true;
			if (widgets.ignoreAncient && widgets.ignoreAncient.getValue()) ignoreTiers.ancient = true;
			var alwaysRefined = !!(widgets.alwaysRefined && widgets.alwaysRefined.getValue());
			var ignoreGizmoCost = !!(widgets.ignoreGizmo && widgets.ignoreGizmo.getValue());
			self.ignoreGizmoCost = ignoreGizmoCost;
			var adjustedPrices = self.computeAdjustedPrices(ignoreTiers, alwaysRefined);
			self.costMaterialPrices = adjustedPrices.cost;

			var blacklist = [];
			var blacklistEmpty = false;
			if (!perk1IsDoubleslot && p2Name === ANY_PERK2 && widgets.blacklist) {
				var rawBl = widgets.blacklist.getValue() || [];
				// (EMPTY) is split out into its own flag so the worker never has
				// to know the UI sentinel; the rest are perk names.
				blacklistEmpty = rawBl.indexOf(EMPTY_PERK2) >= 0;
				blacklist = rawBl.filter(function (b) { return b !== EMPTY_PERK2; });
			}

			return {
				targets: targets,
				gizmoTypes: gizmoTypes,
				ancientModes: ancientModes,
				invLevel: effectiveLevel,
				baseLevel: baseLevel,
				potion: potion,
				maxDistinctMats: maxDistinct,
				blacklist: blacklist,
				blacklistEmpty: blacklistEmpty,
				ignoreCostTiers: Object.keys(ignoreTiers),
				alwaysRefinedCost: alwaysRefined,
				ignoreGizmoCost: ignoreGizmoCost,
				prices: {
					// Scoring: ignored tiers zeroed.
					materialPrices: adjustedPrices.scoring,
					// Gizmo-shell baseline: used as a per-attempt floor in the worker's
					// K-heap scoring. Dropped when the user ignores gizmo cost.
					gizmoPrices: ignoreGizmoCost ? {} : self.gizmoPrices
				}
			};
		},

		// Capture the perkcalc-core price tables
		snapshotPrices: function () {
			self.materialPrices = {};
			self.gizmoPrices = {};
			$('.perkcalc-matcost .perkcalc-matcost-mat').each(function(i,e){
				var $e = $(e);
				self.materialPrices[$e.attr('data-mat-name')] = parseFloat($e.attr('data-mat-price'));
			});
			$('.perkcalc-matcost .perkcalc-gizmocost').each(function(i,e){
				var $e = $(e);
				self.gizmoPrices[$e.attr('data-gizmo')] = parseFloat($e.attr('data-gizmo-price'));
			});
		},
		// Apply the "ignore component costs" options to the price tables.
		// Fallback to real prices for scoring when all costs are ignored.
		computeAdjustedPrices: function (ignoreTiers, alwaysRefined) {
			var real = self.materialPrices || {};
			var cost = {};
			for (var mat in real) {
				var ignored = !!ignoreTiers[self.getMatCategory(mat)];
				// 'Always include Refined comps' option
				if (mat === 'Refined components' && alwaysRefined) ignored = false;
				cost[mat] = ignored ? 0 : real[mat];
			}
			return { cost: cost, scoring: cost };
		},
		getAttemptCost: function (gizmo, materials){
			var prices = self.costMaterialPrices || self.materialPrices;
				var out = self.ignoreGizmoCost ? 0 : self.gizmoPrices[gizmo];
			if (out === undefined || out === null) {
				out = 0;
			}
			for (var i = 0; i<materials.length; i++) {
				var x = prices[materials[i]];
				if (x !== undefined && x !== null) {
					out += x;
				}
			}
			return out;
		},
		round4SF: function(x) {
			var f = 4;
			if (x === 0) return 0;
			var m = Math.floor(Math.log10(x));
			var v = x / Math.pow(10,(m-f));
			v = Math.floor(v+0.5) * Math.pow(10,(m-f));
			return v;
		},
		makeCostCell: function(val, onlySpan) {
			var coins_thresh = [1,2,3,4,5,25,100,250,1000,10000];
			var out = $('<span>');
			var coins_class = 1;
			for (var i = 0; i<coins_thresh.length; i++) {
				if (val < coins_thresh[i]) break;
				coins_class = coins_thresh[i];
			}
			out.addClass('coins coins-pos coins-'+coins_class)
				.data('sortValue', val)
				.text(self.round4SF(val).toLocaleString('en'));
			if (onlySpan) {
				return out;
			}
			return $('<td class="attempt-cost-cell">').append(out);
		},

		runSearch: async function (widgets) {
			var $result = $('#perkCalcResult');
			var params = self.gatherSearchParams(widgets, $result);
			if (!params) return;

			self.setWarnOnUnload(true);

			$result.empty().append(
				$('<div>').append(
					$('<span>').text('Initializing search worker... '),
					$('<span class="perkFinderSpinner">').html('&#9696;')
				)
			);
			widgets.submitBtn.setDisabled(true);

			try {
				const worker = await self.getOrCreateWorker();
				self.startSearchOnWorker(worker, params, widgets, $result);
			} catch (err) {
				$result.empty().append($('<div class="errorbox">').text(
					'Failed to start search worker: ' + (err && err.message ? err.message : err)
				));
				self.resetWorker();
				widgets.submitBtn.setDisabled(false);
				self.setWarnOnUnload(false);
				if (window.console && window.console.error) console.error('[perkfinder]', err);
			}
		},

		startSearchOnWorker: function (worker, params, widgets, $result) {
			var $headline = $('<div class="perkFinderHeadline">');
			var $status = $('<div class="perkFinderStatus">').append(
				$('<span>').text('Starting search... '),
				$('<span class="perkFinderSpinner">').html('&#9696;')
			);
			// Sub-status line beneath the main status line.
			var $subStatus = $('<div class="perkFinderSubStatus">');
			var $table = self.buildResultsTable();
			var $tbody = $table.find('tbody');
			// Pagination footer
			var $showMore = $('<div class="perkFinderShowMore">');
			// "Continue search" prompt for huge searches.
			var $tailContinue = $('<div class="perkFinderTailContinue">');
			// CSV export button
			var $exportRow = $('<div class="perkFinderExportRow">');
			// Output filter panel. Built lazily once the first row arrives
			var $filterPanel = $('<div class="perkFinderFilterPanel">');

			$result.empty().append($headline, $status, $subStatus, $tailContinue, $exportRow, $filterPanel, $table, $showMore);

			widgets.stopBtn.setDisabled(false);
			widgets.stopBtn.setLabel('Stop');
			widgets.stopBtn.toggle(true);

			var perk2IsAny = params.targets.length === 1 && !params.targets.exactCount;

			var t0 = Date.now();
			var rowsCount = 0;
			var enumeratedTotal = null;
			var evaluatedCount = 0;
			var enumerationDone = false;
			var logicalResolved = 0;
			var logicalTotal = 0;
			var recipesPerSecond = 0;

			// Tablesorter init deferred until at least 1 row has been appended
			var tablesorterInited = false;
			var tablesorterFailed = false;
			function tryInitTablesorter() {
				if (tablesorterInited || tablesorterFailed) return;
				if ($tbody.children('tr').length === 0) return;
				if (typeof $.fn.tablesorter !== 'function') return;
				try {
					// Sort by Expected cost (col. 8)
					$table.tablesorter({ sortList: [{ 8: 'asc' }] });
					tablesorterInited = true;
				} catch (err) {
					tablesorterFailed = true;
					if (window.console && window.console.error) {
						console.error('[perkfinder] tablesorter init threw; table will not be sortable.', err);
					}
				}
			}

			// === Pagination + live insertion + sort ===
			// Keep only a small sorted window mounted while a fast multi-core
			// search streams thousands of matches. All rows remain available to
			// filtering, CSV export and the Show next control.
			var PAGE_SIZE = 250;
			var allRowsData = [];
			var filteredView = [];
			var visibleCount = 0;
			var visiblePages = 1;

			// === Filter ===
			var filterState = {
				// Default disabled
				probability: { enabled: false, threshold: 20 }, // 0-100 (%)
				cost:        { enabled: false, threshold: 5000000 },
				// Default enabled
				variant:     { enabled: true, allowed: { Regular: true, Ancient: true } },
				gizmoType:   { enabled: true, allowed: { weapon: true, armour: true, tool: true } },
					// perk2 filter only when in (ANY) mode
				perk2:       { enabled: perk2IsAny, allowed: Object.create(null) },
				components:  { enabled: true, allowed: Object.create(null) }
			};
			var seenPerks = Object.create(null);
			var seenComponents = Object.create(null);
			var perkToggleWidgets = Object.create(null);
			var compToggleWidgets = Object.create(null);

			function extractNonTargetPerks(key) {
				if (!key) return [];
				var target1Name = params.targets[0] && params.targets[0].name;
				var tokens = key.split(',');
				var out = [];
				for (var i = 0; i < tokens.length; i++) {
					var tok = tokens[i];
					var nameEnd = tok.length;
					var j = nameEnd;
					while (j > 0) {
						var ch = tok.charCodeAt(j - 1);
						if (ch < 48 || ch > 57) break;
						j--;
					}
					if (j < nameEnd && j > 0 && tok.charCodeAt(j - 1) === 32) {
						nameEnd = j - 1;
					}
					var name = tok.substring(0, nameEnd);
					if (name && name !== target1Name) out.push(name);
				}
				return out;
			}

			// True if rowData should be visible under the current filter
			function passesFilter(r) {
				var s = filterState;
				if (s.probability.enabled) {
					if ((r.probPerGizmo || 0) * 100 < s.probability.threshold) return false;
				}
				if (s.cost.enabled) {
					var cost = r._expectedCost;
					if (cost == null || cost === Number.MAX_VALUE || cost > s.cost.threshold) return false;
				}
				if (s.variant.enabled) {
					if (!s.variant.allowed[r.ancient ? 'Ancient' : 'Regular']) return false;
				}
				if (s.gizmoType.enabled) {
					if (!s.gizmoType.allowed[r.gizmoType]) return false;
				}
				if (s.perk2.enabled) {
					var perks = extractNonTargetPerks(r.topResultKey || '');
					for (var pi = 0; pi < perks.length; pi++) {
						if (!s.perk2.allowed[perks[pi]]) return false;
					}
				}
				if (s.components.enabled) {
					var mats = r.materials;
					for (var mi = 0; mi < mats.length; mi++) {
						var m = mats[mi];
						if (m === '' || m == null) continue;
						if (!s.components.allowed[m]) return false;
					}
				}
				return true;
			}

			// Rebuild filteredView from allRowsData.
			function rebuildFilteredView() {
				filteredView = [];
				for (var i = 0; i < allRowsData.length; i++) {
					if (passesFilter(allRowsData[i])) filteredView.push(allRowsData[i]);
				}
			}

			// Filter-state change handler
			function reapplyFilter() {
				rebuildFilteredView();
				visibleCount = 0;
				visiblePages = 1;
				rebuildVisibleDOM();
				updateShowMoreBtn();
				// CSV Export respects filter too
				updateExportBtn();
			}

			// Debounced wrapper.
			// 80 ms should be short enough to feel responsive.
			var reapplyTimer = null;
			function scheduleReapply() {
				if (reapplyTimer) clearTimeout(reapplyTimer);
				reapplyTimer = setTimeout(function () {
					reapplyTimer = null;
					reapplyFilter();
				}, 80);
			}

			// DOM-node cache
			function getOrBuildResultRow(r) {
				if (!r._domNode) {
					r._domNode = self.buildResultRow(r)[0];
				}
				return r._domNode;
			}

			// Binary search insertion position
			function findInsertPosFiltered(r) {
				var lo = 0, hi = filteredView.length;
				while (lo < hi) {
					var mid = (lo + hi) >>> 1;
					if (compareRowsData(filteredView[mid], r) <= 0) lo = mid + 1;
					else hi = mid;
				}
				return lo;
			}

			// The local app owns sorting directly so it stays correct while the
			// multi-core worker is streaming rows. Defaults to Expected cost asc.
			var currentSortColumn = 8;
			var currentSortDir = 'asc';
			var currentSortIsNumeric = true;

			function updateSortHeaders() {
				var thead = $table[0].tHead;
				if (!thead || !thead.rows[0]) return;
				var headers = thead.rows[0].cells;
				for (var i = 0; i < headers.length; i++) {
					var header = headers[i];
					header.classList.add('perkFinderSortableHeader');
					header.tabIndex = 0;
					var label = header.getAttribute('data-sort-label') || header.textContent.trim() || 'perk icons';
					header.setAttribute('aria-label', 'Sort by ' + label);
					header.setAttribute('aria-sort', i === currentSortColumn
						? (currentSortDir === 'asc' ? 'ascending' : 'descending')
						: 'none');
				}
			}

			function setSortColumn(column) {
				var thead = $table[0].tHead;
				var header = thead && thead.rows[0] && thead.rows[0].cells[column];
				if (!header) return;
				if (column === currentSortColumn) {
					currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
				} else {
					currentSortColumn = column;
					currentSortDir = 'asc';
				}
				currentSortIsNumeric = header.getAttribute('data-sort-type') === 'number';
				var ts = $table.data('tablesorter');
				if (ts && ts.config) {
					var entry = {};
					entry[currentSortColumn] = currentSortDir;
					ts.config.sortList = [entry];
				}
				updateSortHeaders();
				allRowsData.sort(compareRowsData);
				filteredView.sort(compareRowsData);
				rebuildVisibleDOM();
				updateShowMoreBtn();
			}

			// Compute sort key
			function getDataSortKey(rowData, column) {
				switch (column) {
				case 0:
				case 1: return rowData.topResultKey || '';
				case 2: return rowData.probPerGizmo || 0;
				case 3: return rowData.probPerGizmo > 0 ? 1 / rowData.probPerGizmo : Number.MAX_VALUE;
				case 4: return rowData._sortLevel != null ? rowData._sortLevel : 0;
				case 5: {
					var mats = rowData.materials;
					if (!mats) return '';
					var counts = Object.create(null);
					for (var k = 0; k < mats.length; k++) {
						counts[mats[k]] = (counts[mats[k]] || 0) + 1;
					}
					var order = Object.keys(counts).sort(function (a, b) {
						if (a === '' && b !== '') return 1;
						if (b === '' && a !== '') return -1;
						if (a === '' && b === '') return 0;
						if (counts[a] !== counts[b]) return counts[b] - counts[a];
						return a < b ? -1 : a > b ? 1 : 0;
					});
					var s = '';
					for (var i = 0; i < order.length; i++) {
						if (i > 0) s += ',';
						s += counts[order[i]] + '× ' + (order[i] === '' ? '(empty)' : order[i]);
					}
					return s;
				}
				case 6: return rowData.ancient ? 'Ancient' : 'Regular';
				case 7: return rowData.gizmoType
					? rowData.gizmoType.charAt(0).toUpperCase() + rowData.gizmoType.slice(1)
					: '';
				case 8: return rowData._expectedCost != null ? rowData._expectedCost : Number.MAX_VALUE;
				}
				return '';
			}

			function compareRowsData(a, b) {
				var keyA = getDataSortKey(a, currentSortColumn);
				var keyB = getDataSortKey(b, currentSortColumn);
				var cmp = currentSortIsNumeric
					? (keyA - keyB)
					: (keyA < keyB ? -1 : keyA > keyB ? 1 : 0);
				return currentSortDir === 'desc' ? -cmp : cmp;
			}
			
			// Cache the values used as sort keys
			function annotateRowData(r) {
				r._sortLevel = (r.bestLevels && r.bestLevels.length)
					? Math.min.apply(null, r.bestLevels) : 0;
				if (r.probPerGizmo > 0) {
					var gizmoFullName = (r.ancient ? 'ancient ' : '') + r.gizmoType;
					var attemptCost = self.getAttemptCost(gizmoFullName, r.materials);
					r._expectedCost = attemptCost / r.probPerGizmo;
				} else {
					r._expectedCost = Number.MAX_VALUE;
				}
			}

			function findInsertPos(r) {
				var lo = 0, hi = allRowsData.length;
				while (lo < hi) {
					var mid = (lo + hi) >>> 1;
					if (compareRowsData(allRowsData[mid], r) <= 0) lo = mid + 1;
					else hi = mid;
				}
				return lo;
			}

			// === Filter UI ===
			// Built lazily on first row arrival
			var filterPanelBuilt = false;
			var perkGroup = null;          // perk2 toggles
			var perkOrder = [];            // sorted perk-name list
			var compGroups = null;         // { common, uncommon, rare, ancient }
			var compOrder = null;          // { common: [], uncommon: [], rare: [], ancient: [] }
			var compRowSelectors = null;   // 3-state On/—/Off ButtonSelectWidget
			var compRowEls = null;         // $row, hidden until the tier has comps
			var settingCompRowBulk = false; // suppress per-toggle sync/reapply during On/Off
			var $filterBody = null;
			var filterCheckIdCounter = 0;

			function maybeBuildFilterPanel() {
				if (filterPanelBuilt) return;
				if (allRowsData.length === 0) return;
				filterPanelBuilt = true;
				buildFilterPanel();
			}

			function makeFilterRow(label, $controlEl, opts) {
				filterCheckIdCounter++;
				var inputId = 'perkFinderFilterChk_' + filterCheckIdCounter;
				var enabled = opts && opts.initialEnabled !== false;
				var checkbox = new OO.ui.CheckboxInputWidget({
					selected: enabled,
					inputId: inputId
				});
				checkbox.on('change', function (selected) {
					opts.onEnableChange(selected);
					scheduleReapply();
				});
				return $('<div class="perkFinderFilterRow">').append(
					$('<span class="perkFinderFilterCheck">').append(checkbox.$element),
					$('<label class="perkFinderFilterLabel">').attr('for', inputId).text(label),
					$('<span class="perkFinderFilterControl">').append($controlEl)
				);
			}

			function buildFilterPanel() {
				var rows = [];

				// --- Probability (>= threshold %) ---
				var probInput = new OO.ui.NumberInputWidget({
					min: 0, max: 100, step: 0.1,
					value: filterState.probability.threshold
				});
				probInput.on('change', function (value) {
					var n = parseFloat(value);
					if (!isNaN(n)) {
						filterState.probability.threshold = n;
						if (filterState.probability.enabled) scheduleReapply();
					}
				});
				var $probWrap = $('<span class="perkFinderFilterNumWrap">').append(
					probInput.$element,
					$('<span class="perkFinderFilterUnit">').text('%')
				);
				rows.push(makeFilterRow('Probability (≥)', $probWrap, {
					initialEnabled: filterState.probability.enabled,
					onEnableChange: function (v) { filterState.probability.enabled = v; }
				}));

				// --- Expected cost (<= threshold gp) ---
				var costInput = new OO.ui.NumberInputWidget({
					min: 1, step: 1, isInteger: true,
					value: filterState.cost.threshold
				});
				costInput.on('change', function (value) {
					var n = parseInt(value, 10);
					if (!isNaN(n) && n > 0) {
						filterState.cost.threshold = n;
						if (filterState.cost.enabled) scheduleReapply();
					}
				});
				var $costWrap = $('<span class="perkFinderFilterNumWrap">').append(
					costInput.$element,
					$('<span class="perkFinderFilterUnit">').text('gp')
				);
				rows.push(makeFilterRow('Cost (≤)', $costWrap, {
					initialEnabled: filterState.cost.enabled,
					onEnableChange: function (v) { filterState.cost.enabled = v; }
				}));

				// --- Gizmo variant (iff input >1 variant) ---
				if (params.ancientModes.length > 1) {
					var variantRegBtn = new OO.ui.ToggleButtonWidget({
						label: 'Regular', value: true
					});
					var variantAncBtn = new OO.ui.ToggleButtonWidget({
						label: 'Ancient', value: true
					});
					variantRegBtn.on('change', function (v) {
						filterState.variant.allowed.Regular = v;
						if (filterState.variant.enabled) scheduleReapply();
					});
					variantAncBtn.on('change', function (v) {
						filterState.variant.allowed.Ancient = v;
						if (filterState.variant.enabled) scheduleReapply();
					});
					var variantGroup = new OO.ui.ButtonGroupWidget({
						items: [variantRegBtn, variantAncBtn]
					});
					rows.push(makeFilterRow('Gizmo variant', variantGroup.$element, {
						initialEnabled: filterState.variant.enabled,
						onEnableChange: function (v) { filterState.variant.enabled = v; }
					}));
				}

				// --- Gizmo type (iff input >1 type) ---
				if (params.gizmoTypes.length > 1) {
					var typeLabels = { weapon: 'Weapon', armour: 'Armour', tool: 'Tool' };
					var typeBtnItems = [];
					params.gizmoTypes.forEach(function (gt) {
						var btn = new OO.ui.ToggleButtonWidget({
							label: new OO.ui.HtmlSnippet(
								'<span class="perkCalcShell" data-shell="' + gt + '"></span> ' +
								mw.html.escape(typeLabels[gt] || gt)
							),
							value: true
						});
						btn.on('change', function (v) {
							filterState.gizmoType.allowed[gt] = v;
							if (filterState.gizmoType.enabled) scheduleReapply();
						});
						typeBtnItems.push(btn);
					});
					var typeGroup = new OO.ui.ButtonGroupWidget({ items: typeBtnItems });
					rows.push(makeFilterRow('Gizmo type', typeGroup.$element, {
						initialEnabled: filterState.gizmoType.enabled,
						onEnableChange: function (v) { filterState.gizmoType.enabled = v; }
					}));
				}

				// --- Perk 2 (iff input (ANY)) ---
				if (perk2IsAny) {
					perkGroup = new OO.ui.ButtonGroupWidget({
						classes: ['perkFinderFilterIconGroup']
					});
					rows.push(makeFilterRow('Perk 2', perkGroup.$element, {
						initialEnabled: filterState.perk2.enabled,
						onEnableChange: function (v) { filterState.perk2.enabled = v; }
					}));
				}

				// --- Allowed components (grouped by rarity) ---
				compGroups = {
					common:   new OO.ui.ButtonGroupWidget({ classes: ['perkFinderFilterIconGroup'] }),
					uncommon: new OO.ui.ButtonGroupWidget({ classes: ['perkFinderFilterIconGroup'] }),
					rare:     new OO.ui.ButtonGroupWidget({ classes: ['perkFinderFilterIconGroup'] }),
					ancient:  new OO.ui.ButtonGroupWidget({ classes: ['perkFinderFilterIconGroup'] })
				};
				compOrder = { common: [], uncommon: [], rare: [], ancient: [] };
				// Per-rarity On/—/Off selector.
				compRowSelectors = {};
				compRowEls = {};
				var $compStack = $('<div class="perkFinderFilterIconStack">');
				['common', 'uncommon', 'rare', 'ancient'].forEach(function (cat) {
					var sel = new OO.ui.ButtonSelectWidget({ classes: ['perkFinderCompRowSelect'] });
					var midOpt = new OO.ui.ButtonOptionWidget({ data: 'mixed', label: '' });
					sel.addItems([
						new OO.ui.ButtonOptionWidget({ data: 'on', label: 'On' }),
						midOpt,
						new OO.ui.ButtonOptionWidget({ data: 'off', label: 'Off' })
					]);
					midOpt.$element.hide();
					sel.selectItemByData('on');    // default: all on
					sel.on('choose', function (item) {
						var d = item && item.getData();
						if (d === 'on') setCompRowAll(cat, true);
						else if (d === 'off') setCompRowAll(cat, false);
					});
					compRowSelectors[cat] = sel;
					var $row = $('<div class="perkFinderCompRow">').append(
						sel.$element, compGroups[cat].$element
					).hide();                      // shown once the rarity has a component
					compRowEls[cat] = $row;
					$compStack.append($row);
				});
				rows.push(makeFilterRow('Allowed components', $compStack, {
					initialEnabled: filterState.components.enabled,
					onEnableChange: function (v) { filterState.components.enabled = v; }
				}));

				// Master toggle switch
				var masterSwitch = new OO.ui.ToggleSwitchWidget({ value: false });
				$filterBody = $('<div class="perkFinderFilterBody">').hide().append(rows);
				masterSwitch.on('change', function (v) {
					$filterBody.toggle(v);
				});
				$filterPanel.empty().append(
					$('<div class="perkFinderFilterHeader">').append(
						masterSwitch.$element,
						$('<span class="perkFinderFilterHeaderText">').text(
							'Filter output (does not affect search)'
						)
					),
					$filterBody
				);

				// Backfill icon toggles for perks/components seen
				// before the panel was built.
				if (perkGroup) {
					var preP = Object.keys(seenPerks).sort();
					for (var i = 0; i < preP.length; i++) injectPerkIconToggle(preP[i]);
				}
				var preC = Object.keys(seenComponents);
				for (var j = 0; j < preC.length; j++) injectCompIconToggle(preC[j]);
			}

			function injectPerkIconToggle(perkName) {
				if (!perkGroup) return;
				if (perkToggleWidgets[perkName]) return;

				var lo = 0, hi = perkOrder.length;
				while (lo < hi) {
					var mid = (lo + hi) >>> 1;
					if (perkOrder[mid] < perkName) lo = mid + 1;
					else hi = mid;
				}
				var btn = new OO.ui.ToggleButtonWidget({
					label: new OO.ui.HtmlSnippet(
						'<span class="perkCalcPerk">' +
						'<span class="perkCalcPerkImg" data-perk="' + mw.html.escape(perkName) + '"></span>' +
						'</span>'
					),
					value: true,
					framed: true,
					classes: ['perkFinderFilterIconToggle']
				});
				btn.$element.attr('title', perkName);
				btn.on('change', function (v) {
					filterState.perk2.allowed[perkName] = v;
					if (filterState.perk2.enabled) scheduleReapply();
				});
				perkToggleWidgets[perkName] = btn;
				perkOrder.splice(lo, 0, perkName);
				// insert at given position in alphabetical perkOrder.
				perkGroup.addItems([btn], lo);
			}

			// Reflect a rarity's component toggles in its On/—/Off selector.
			function syncCompRowSelector(cat) {
				var sel = compRowSelectors && compRowSelectors[cat];
				if (!sel) return;
				var names = compOrder[cat];
				if (names.length === 0) { sel.selectItemByData('on'); return; }
				var allOn = true, allOff = true;
				for (var i = 0; i < names.length; i++) {
					var v = compToggleWidgets[names[i]].getValue();
					if (v) allOff = false; else allOn = false;
				}
				sel.selectItemByData(allOn ? 'on' : (allOff ? 'off' : 'mixed'));
			}
			function setCompRowAll(cat, on) {
				var names = compOrder[cat];
				settingCompRowBulk = true;     // skip per-toggle sync/reapply
				for (var i = 0; i < names.length; i++) {
					var btn = compToggleWidgets[names[i]];
					if (btn && btn.getValue() !== on) btn.setValue(on);
				}
				settingCompRowBulk = false;
				syncCompRowSelector(cat);
				if (filterState.components.enabled) scheduleReapply();
			}

			function injectCompIconToggle(matName) {
				if (!compGroups) return;
				if (compToggleWidgets[matName]) return;
				// getMatCategory returns 'common' | 'uncommon' |
				// 'rare' | 'ancient' | 'empty'. We don't expect
				// 'empty' here, but default to 'common' to be safe.
				var cat = self.getMatCategory(matName);
				if (!compGroups[cat]) cat = 'common';
				// New components respect the rarity's master state.
				var rowSel = compRowSelectors && compRowSelectors[cat];
				var startOn = !(rowSel && rowSel.findSelectedItem() &&
					rowSel.findSelectedItem().getData() === 'off');
				filterState.components.allowed[matName] = startOn;
				var arr = compOrder[cat];
				var lo = 0, hi = arr.length;
				while (lo < hi) {
					var mid = (lo + hi) >>> 1;
					if (arr[mid] < matName) lo = mid + 1;
					else hi = mid;
				}
				var btn = new OO.ui.ToggleButtonWidget({
					label: new OO.ui.HtmlSnippet(
						'<span class="perkCalcCompImg" data-comp="' + mw.html.escape(matName) + '"></span>'
					),
					value: startOn,
					framed: true,
					classes: ['perkFinderFilterIconToggle']
				});
				btn.$element.attr('title', matName);
				btn.on('change', function (v) {
					filterState.components.allowed[matName] = v;
					if (settingCompRowBulk) return; // setCompRowAll syncs + reapplies once
					syncCompRowSelector(cat);
					if (filterState.components.enabled) scheduleReapply();
				});
				compToggleWidgets[matName] = btn;
				arr.splice(lo, 0, matName);
				compGroups[cat].addItems([btn], lo);
				if (compRowEls && compRowEls[cat]) compRowEls[cat].show();
				syncCompRowSelector(cat);
			}

			// Record any new perks / components a row exposes
			function trackRowFilters(r) {
				if (perk2IsAny) {
					var perks = extractNonTargetPerks(r.topResultKey || '');
					for (var pi = 0; pi < perks.length; pi++) {
						var pn = perks[pi];
						if (!seenPerks[pn]) {
							seenPerks[pn] = true;
							filterState.perk2.allowed[pn] = true;
							injectPerkIconToggle(pn);
						}
					}
				}
				var mats = r.materials;
				for (var mi = 0; mi < mats.length; mi++) {
					var m = mats[mi];
					if (!m) continue;
					if (!seenComponents[m]) {
						seenComponents[m] = true;
						filterState.components.allowed[m] = true;
						injectCompIconToggle(m);
					}
				}
			}

			function updateShowMoreBtn() {
				var remaining = filteredView.length - visibleCount;
				if (remaining <= 0) {
					$showMore.empty();
					return;
				}
				var next = Math.min(remaining, PAGE_SIZE);
				// "hidden" here counts only the buffered tail
				$showMore.empty().append(
					$('<button type="button" class="perkFinderShowMoreBtn">').text(
						'Show next ' + next.toLocaleString() + ' rows (' +
						remaining.toLocaleString() + ' hidden)'
					).on('click', showMore)
				);
			}

			function showMore() {
				visiblePages++;
				var cap = visiblePages * PAGE_SIZE;
				var newEnd = Math.min(filteredView.length, cap);
				var tbodyEl = $tbody[0];
				var frag = document.createDocumentFragment();
				for (var i = visibleCount; i < newEnd; i++) {
					frag.appendChild(getOrBuildResultRow(filteredView[i]));
				}
				tbodyEl.appendChild(frag);
				visibleCount = newEnd;
				updateShowMoreBtn();
			}

			function rebuildVisibleDOM() {
				var tbodyEl = $tbody[0];
				while (tbodyEl.firstChild) tbodyEl.removeChild(tbodyEl.firstChild);
				var cap = visiblePages * PAGE_SIZE;
				var end = Math.min(filteredView.length, cap);
				if (end === 0) { visibleCount = 0; return; }
				var frag = document.createDocumentFragment();
				for (var i = 0; i < end; i++) {
					frag.appendChild(getOrBuildResultRow(filteredView[i]));
				}
				tbodyEl.appendChild(frag);
				visibleCount = end;
			}

			// Append one row arriving from worker
			function appendNewRow(r, deferUiRefresh) {
				annotateRowData(r);
				var pos = findInsertPos(r);
				allRowsData.splice(pos, 0, r);
				// Update filter UI with new perks / components
				trackRowFilters(r);
				if (passesFilter(r)) {
					var fpos = findInsertPosFiltered(r);
					filteredView.splice(fpos, 0, r);
					var cap = visiblePages * PAGE_SIZE;
					if (!deferUiRefresh && fpos < cap) {
						var tbodyEl = $tbody[0];
						var rows = tbodyEl.rows;
						var node = getOrBuildResultRow(r);
						if (fpos >= rows.length) {
							tbodyEl.appendChild(node);
						} else {
							tbodyEl.insertBefore(node, rows[fpos]);
						}
						while (rows.length > cap) {
							tbodyEl.removeChild(rows[rows.length - 1]);
						}
						visibleCount = rows.length;
					}
				}
				if (!deferUiRefresh) {
					updateShowMoreBtn();
					updateExportBtn();
					// Reveal the filter panel once at least one row has arrived
					maybeBuildFilterPanel();
				}
			}

			// Reveal Export CSV button
			function updateExportBtn() {
				if (filteredView.length === 0) {
					$exportRow.empty();
					return;
				}
				if ($exportRow.children().length > 0) return;
				$exportRow.append(
					$('<button type="button" class="perkFinderExportBtn">')
						.text('Export CSV')
						.attr('title', 'Download the currently-visible (filtered) results as a CSV file. Safe to use during an active search -- the snapshot is taken from the rows already received.')
						.on('click', exportCSV)
				);
			}

			// CSV escape: wrap in double quotes when needed
			function csvEscape(s) {
				s = String(s);
				if (/[",\r\n]/.test(s)) {
					return '"' + s.replace(/"/g, '""') + '"';
				}
				return s;
			}

			function formatMaterialsForCsv(materials) {
				var byMat = Object.create(null);
				for (var i = 0; i < materials.length; i++) {
					byMat[materials[i]] = (byMat[materials[i]] || 0) + 1;
				}
				var order = Object.keys(byMat).sort(function (a, b) {
					if (a === '' && b !== '') return 1;
					if (b === '' && a !== '') return -1;
					if (a === '' && b === '') return 0;
					if (byMat[a] !== byMat[b]) return byMat[b] - byMat[a];
					return a < b ? -1 : a > b ? 1 : 0;
				});
				var parts = [];
				for (var k = 0; k < order.length; k++) {
					parts.push(byMat[order[k]] + 'x ' + (order[k] === '' ? '(empty)' : order[k]));
				}
				return parts.join(', ');
			}

			function exportCSV() {
				if (filteredView.length === 0) return;
				var snapshot = filteredView.slice();
				var header = [
					'Perk combination', 'Probability (%)', 'Probability (1/x)',
					'Level', 'Required components', 'Perk calculator link',
					'Variant', 'Gizmo type', 'Expected cost'
				];
				var origin = window.location && window.location.origin
					? window.location.origin : '';
				// search settings included as JSON in top row.
				var settings = {
					targets: params.targets,
					gizmoTypes: params.gizmoTypes,
					variants: params.ancientModes.map(function (a) { return a ? 'Ancient' : 'Regular'; }),
					invLevel: params.invLevel,
					baseLevel: params.baseLevel,
					potion: params.potion,
					maxDistinctMats: params.maxDistinctMats,
					blacklist: params.blacklist,
					blacklistEmpty: params.blacklistEmpty,
					ignoreCostTiers: params.ignoreCostTiers,
					alwaysRefinedCost: params.alwaysRefinedCost,
					ignoreGizmoCost: params.ignoreGizmoCost
				};
				var lines = [csvEscape(JSON.stringify(settings)), header.join(',')];
				for (var i = 0; i < snapshot.length; i++) {
					var r = snapshot[i];
					var probPct = r.probPerGizmo > 0 ? (r.probPerGizmo * 100).toFixed(4) : '0';
					var probInv = r.probPerGizmo > 0 ? (1 / r.probPerGizmo).toFixed(2) : '';
					var levelStr = self.formatLevels(r.bestLevels);
					var matsStr = formatMaterialsForCsv(r.materials || []);
					var calcLink = origin + self.buildCalcPerksUrl(r, self.pickLinkLevel(r));
					var variant = r.ancient ? 'Ancient' : 'Regular';
					var gtype = r.gizmoType
						? r.gizmoType.charAt(0).toUpperCase() + r.gizmoType.slice(1)
						: '';
					var cost = (r._expectedCost != null && r._expectedCost !== Number.MAX_VALUE)
						? Math.round(r._expectedCost).toString()
						: '';
					lines.push([
						csvEscape(r.topResultKey || ''),
						probPct,
						probInv,
						csvEscape(levelStr),
						csvEscape(matsStr),
						csvEscape(calcLink),
						variant,
						gtype,
						cost
					].join(','));
				}

				// Prepend the UTF-8 BOM so Excel detects the encoding
				var csv = '﻿' + lines.join('\r\n');

				// Filename: target perks + date
				var perkParts = params.targets.map(function (t) {
					return t.name.replace(/[^a-zA-Z0-9]+/g, '_');
				}).join('+');
				var dt = new Date();
				var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
				var stamp = dt.getFullYear() + pad(dt.getMonth() + 1) + pad(dt.getDate()) +
					'-' + pad(dt.getHours()) + pad(dt.getMinutes()) + pad(dt.getSeconds());
				var filename = 'perk-finder-' + perkParts + '-' + stamp + '.csv';

				var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
				var url = URL.createObjectURL(blob);
				var a = document.createElement('a');
				a.href = url;
				a.download = filename;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
			}

			updateSortHeaders();

			// Header sorting is independent of the Wiki tablesorter plugin. That
			// avoids event-order races and keeps every paginated row in sync.
			$table.on('click', 'thead th', function () {
				setSortColumn(this.cellIndex);
			});
			$table.on('keydown', 'thead th', function (event) {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
				setSortColumn(this.cellIndex);
			});

			// Hard-kill: terminates worker
			var doCancel = function () {
				if (!self.activeSearchCancel) return;
				self.activeSearchCancel = null;
				try { worker.terminate(); } catch (e) {}
				worker.removeEventListener('message', msgHandler);
				self.resetWorker();
				widgets.stopBtn.toggle(false);
				widgets.submitBtn.setDisabled(false);
				$subStatus.text('');
				$tailContinue.empty();
				var elapsed = ((Date.now() - t0) / 1000).toFixed(2);
				self.finalizeSearch($headline, $status, $table, params, rowsCount, elapsed, true, {
					logicalResolved: logicalResolved,
					logicalTotal: logicalTotal,
					recipesPerSecond: recipesPerSecond,
					evaluatedCount: evaluatedCount,
					evaluatedTotal: enumeratedTotal
				});
			};
			self.activeSearchCancel = doCancel;

			// Status messages
			var msgHandler = function (e) {
				var msg = e.data || {};
				if (msg.type === 'started') {
					t0 = msg.timestamp || Date.now();
					$status.empty().append(
						$('<span>').text('Searching... '),
						$('<span class="perkFinderSpinner">').html('&#9696;')
					);
				} else if (msg.type === 'progress') {
					var d = msg.data || {};
					if (d.logicalTotalCandidates != null) logicalTotal = d.logicalTotalCandidates;
					if (d.logicalResolved != null) logicalResolved = d.logicalResolved;
					if (d.recipesPerSecond != null) recipesPerSecond = d.recipesPerSecond;
					if (d.phase === 'enumerating') {
						var enumText = 'Applying exact proof bounds: ' +
							d.enumerated.toLocaleString() + ' potentially viable recipes found';
						if (logicalTotal > 0) {
							enumText += ' across ' + logicalTotal.toLocaleString() + ' legal recipes';
						}
						enumText += '. ';
						if (rowsCount > 0) {
							enumText += rowsCount.toLocaleString() + ' matches so far. ';
						}
						$status.empty().append(
							$('<span>').text(enumText),
							$('<span class="perkFinderSpinner">').html('&#9696;')
						);
					} else if (d.phase === 'enumerated') {
						enumerationDone = true;
						enumeratedTotal = d.total;
						evaluatedCount = 0;
						self.updateStatus($status, rowsCount, evaluatedCount, enumeratedTotal,
							logicalResolved, logicalTotal, recipesPerSecond);
					} else if (d.phase === 'evaluating') {
						evaluatedCount = d.current;
						if (enumerationDone) {
							self.updateStatus($status, rowsCount, evaluatedCount, enumeratedTotal,
								logicalResolved, logicalTotal, recipesPerSecond);
						}
					}
				} else if (msg.type === 'result' || msg.type === 'result-batch') {
					var incomingRows = msg.type === 'result-batch' ? (msg.rows || []) : [msg.row];
					rowsCount += incomingRows.length;
					for (var ri = 0; ri < incomingRows.length; ri++) {
						appendNewRow(incomingRows[ri], true);
					}
					rebuildVisibleDOM();
					updateShowMoreBtn();
					updateExportBtn();
					maybeBuildFilterPanel();
					// First row enables tablesorter
					tryInitTablesorter();

					if (enumerationDone) {
						self.updateStatus($status, rowsCount, evaluatedCount, enumeratedTotal,
							logicalResolved, logicalTotal, recipesPerSecond);
					}
					// Clear stale subprogress text when new combo row arrives
					$subStatus.text('');
				} else if (msg.type === 'subprogress') {
					var sd = msg.data || {};
					var subTxt = 'Currently evaluating combo: permutation ' + sd.permsCurrent;
					if (sd.permsTotal != null) {
						subTxt += ' / ' + sd.permsTotal;
					}
					if (sd.phase === 'exhaustive') subTxt += ' (exhaustive)';
					else if (sd.phase === 'probe' || sd.phase === 'heuristic') subTxt += ' (probe)';
					$subStatus.text(subTxt);
				} else if (msg.type === 'tail-paused') {
					// Worker emitted a batch and is now idle,
					// holding the searchSession. Show notice + Continue btn.
					$subStatus.text('');
					var totalShown = rowsCount.toLocaleString();
					var noticeText = 'Showing the top ' + totalShown +
						' results so far. The search space has additional ' +
						'lower-likelihood candidates that haven\'t been ' +
						'evaluated yet. Click "Continue search" to evaluate ' +
						'the next batch.';
					$status.empty().append($('<span>').text(
						'Paused at ' + totalShown + ' results. Click "Continue search" below for more.'
					));
					$tailContinue.empty().append(
						$('<div class="perkFinderTailNotice">').text(noticeText),
						$('<button type="button" class="perkFinderContinueBtn">')
							.text('Continue search')
							.on('click', function () {
								$tailContinue.empty();
								$status.empty().append(
									$('<span>').text('Evaluating next batch of candidate combos. '),
									$('<span class="perkFinderSpinner">').html('&#9696;')
								);
								worker.postMessage({ type: 'continue-tail' });
							})
					);
				} else if (msg.type === 'done' || msg.type === 'cancelled') {
					if (msg.searchMs != null) $('#boot-status').text('Native Rust engine · ' + msg.searchMs.toFixed(2) + ' ms search time (UI and transfer excluded)');
					var elapsed = ((Date.now() - t0) / 1000).toFixed(2);
					self.activeSearchCancel = null;
					worker.removeEventListener('message', msgHandler);
					widgets.stopBtn.toggle(false);
					widgets.submitBtn.setDisabled(false);
					$subStatus.text('');
					$tailContinue.empty();
					tryInitTablesorter();
					if (tablesorterInited) {
						try {
							var ts = $table.data('tablesorter');
							if (ts && typeof ts.sort === 'function') ts.sort();
						} catch (err) {
							if (window.console && window.console.error) {
								console.error('[perkfinder] final sort failed:', err);
							}
						}
					}
					self.finalizeSearch($headline, $status, $table, params, rowsCount, elapsed, msg.type === 'cancelled', {
						logicalResolved: logicalResolved,
						logicalTotal: logicalTotal,
						recipesPerSecond: recipesPerSecond,
						evaluatedCount: evaluatedCount,
						evaluatedTotal: enumeratedTotal
					});
				} else if (msg.type === 'error') {
					$status.empty();
					$subStatus.text('');
					$tailContinue.empty();
					$headline.empty().append($('<div class="errorbox">').text('Error: ' + msg.message));
					widgets.stopBtn.toggle(false);
					self.activeSearchCancel = null;
					worker.removeEventListener('message', msgHandler);
					self.resetWorker();
					widgets.submitBtn.setDisabled(false);
				}
			};

			worker.addEventListener('message', msgHandler);

			mw.loader.using(['jquery.tablesorter', 'jquery.tablesorter.styles']).then(function () {
				// Both modules ready
				// if rows have already arrived, init now.
				tryInitTablesorter();
			}, function (err) {
				tablesorterFailed = true;
				if (window.console && window.console.error) {
					console.error('[perkfinder] jquery.tablesorter failed to load; table will not be sortable.', err);
				}
			});

			worker.postMessage({ type: 'search', params: params });
		},

		formatRate: function (rate) {
			if (!isFinite(rate) || rate <= 0) return '0';
			if (rate >= 1000000) return (rate / 1000000).toFixed(2) + 'm';
			if (rate >= 1000) return (rate / 1000).toFixed(1) + 'k';
			return Math.round(rate).toLocaleString();
		},

		updateStatus: function ($status, rowsCount, evaluatedCount, enumeratedTotal,
			logicalResolved, logicalTotal, recipesPerSecond) {
			var text;
			if (logicalTotal > 0 && enumeratedTotal != null) {
				text = 'Resolved ' + logicalResolved.toLocaleString() + ' / ' +
					logicalTotal.toLocaleString() + ' logical recipes (' +
					self.formatRate(recipesPerSecond) + '/s). Exactly evaluated ' +
					evaluatedCount.toLocaleString() +
					' / ' + enumeratedTotal.toLocaleString() +
					' mathematical survivors. ' + rowsCount.toLocaleString() + ' matches so far.';
			} else if (enumeratedTotal != null) {
				text = 'Exactly evaluated ' + evaluatedCount.toLocaleString() +
					' / ' + enumeratedTotal.toLocaleString() +
					' candidate combos. ' + rowsCount.toLocaleString() + ' matches so far.';
			} else {
				text = rowsCount.toLocaleString() + ' matches so far...';
			}
			$status.empty().append(
				$('<span>').text(text + ' '),
				$('<span class="perkFinderSpinner">').html('&#9696;')
			);
		},

		finalizeSearch: function ($headline, $status, $table, params, rowsCount, elapsed, wasCancelled, metrics) {
			metrics = metrics || {};
			var targetDesc = params.targets.map(function (t) {
				return t.name + (t.minRank > 1 ? ' (rank >= ' + t.minRank + ')' : '');
			}).join(' + ');
			var levelDesc;
			if (params.potion && params.potion !== 'none') {
				levelDesc = 'searched levels 1-' + params.invLevel +
					' (max = ' + params.baseLevel + ' + ' + params.potion + ' potion)';
			} else {
				levelDesc = 'searched levels 1-' + params.invLevel;
			}

			var resolved = wasCancelled ? (metrics.logicalResolved || 0) :
				(metrics.logicalTotal || metrics.logicalResolved || 0);
			var rate = resolved > 0 ? resolved / Math.max(0.001, parseFloat(elapsed)) : 0;
			var statusText = (wasCancelled ? 'Search cancelled. ' : 'Search complete. ');
			if (resolved > 0) {
				statusText += resolved.toLocaleString() + ' logical recipes resolved in ' + elapsed +
					's (' + self.formatRate(rate) + '/s). ';
			}
			statusText += rowsCount.toLocaleString() + ' exact matches.';
			$status.text(statusText);

			$headline.empty().append($('<p>').append(
				$('<b>').text(rowsCount.toLocaleString()),
				' matching material combinations for ',
				$('<b>').text(targetDesc),
				', ' + levelDesc + '. Each row shows the level (or range) at which the combo has its highest probability. ',
				wasCancelled ? '(Stopped early.)' : ''
			));

			if (rowsCount === 0) {
				$headline.append($('<div>').text(
					'No matches found. Try lowering the minimum rank, raising the ' +
					'distinct-material cap, or checking additional gizmo types and variants.'
				));
			}
		},

		// === Table rendering ===

		buildResultsTable: function () {
			// Columns:
			//   0: Perk icons (sorted by perk combination, blank header)
			//   1: Perk combination
			//   2: Prob. per attempt (%)
			//   3: Prob. per attempt (~1/x)
			//   4: Level
			//   5: Required components
			//   6: Gizmo variant
			//   7: Gizmo type
			//   8: Expected cost (default-sort target)
			var $table = $('<table class="wikitable sortable align-right-3 align-right-4 align-right-5 align-right-9">');
			$table.append($('<thead>').append($('<tr>').append(
				$('<th>').attr('data-sort-label', 'perk icons').text(''),
				$('<th>').text('Highest perk combination'),
				$('<th>').attr('data-sort-type', 'number').text('Prob. per attempt (%)'),
				$('<th>').attr('data-sort-type', 'number').text('Prob. per attempt (~1/x)'),
				$('<th>').attr('data-sort-type', 'number').text('Level'),
				$('<th>').html('Required components<br>(click to open Perk Calculator)'),
				$('<th>').text('Gizmo variant'),
				$('<th>').text('Gizmo type'),
				$('<th>').attr('data-sort-type', 'number').text('Expected cost')
			)));
			$table.append($('<tbody>'));
			return $table;
		},

		// Construct <tr> for 1 result row.
		// Attaching is done by insertRowSorted instead.
		buildResultRow: function (r) {
			// Count + sort required comps:
			//   - empty slots always last
			//   - then by descending count
			//   - then alphabetically for ties
			// this sort only governs visual layout.
			var byMat = Object.create(null);
			r.materials.forEach(function (m) { byMat[m] = (byMat[m] || 0) + 1; });
			var matOrder = Object.keys(byMat).sort(function (a, b) {
				if (a === '' && b !== '') return 1;
				if (b === '' && a !== '') return -1;
				if (a === '' && b === '') return 0;
				if (byMat[a] !== byMat[b]) return byMat[b] - byMat[a];
				return a < b ? -1 : a > b ? 1 : 0;
			});

			var linkLevel = self.pickLinkLevel(r);
			var $matLink = $('<a>')
				.attr('href', self.buildCalcPerksUrl(r, linkLevel))
				.attr('target', '_blank')
				.attr('rel', 'noopener')
				.attr('class', 'perkFinderMatLink')
				.attr('title', 'Open this combination in Calculator:Perks');
			matOrder.forEach(function (m, i) {
				var cat = self.getMatCategory(m);
				var $grp = $('<span class="perkFinderMatGroup">').attr('data-cat', cat);
				$grp.append($('<span class="perkFinderMatCount">').text(byMat[m] + '×'));
				if (m === '') {
					$grp.append($('<span class="perkFinderMatEmpty">').text(' (empty)'));
				} else {
					// Reuse perkcalc-core's global .perkCalcCompImg rule
					$grp.append($('<span class="perkCalcCompImg">').attr({ 'data-comp': m, 'title': m }));
				}
				if (i < matOrder.length - 1) $grp.append(',');
				$matLink.append($grp);
			});

			var $matCell = $('<td class="perkFinderMatCell">').append($matLink);

			var gizmoType = r.gizmoType.charAt(0).toUpperCase() + r.gizmoType.slice(1);
			var gizmoVariant = r.ancient ? 'Ancient' : 'Regular';

			var $costCell = $('<td>');
			if (r.probPerGizmo > 0) {
				var gizmoFullName = (r.ancient ? 'ancient ' : '') + r.gizmoType;
				var attemptCost = self.getAttemptCost(gizmoFullName, r.materials);
				var expectedCost = attemptCost / r.probPerGizmo;
				$costCell.attr('data-sort-value', expectedCost)
					.append(self.makeCostCell(expectedCost, true));
			} else {
				$costCell.text('-').attr('data-sort-value', Number.MAX_VALUE);
			}

			var levelStr = self.formatLevels(r.bestLevels);
			var sortLevel = (r.bestLevels && r.bestLevels.length) ? Math.min.apply(null, r.bestLevels) : 0;

			var $tr = $('<tr>').append(
				self.makePerkIconCell(r.topResultKey),
				self.makePerkLinkCell(r.topResultKey),
				$('<td>').attr('data-sort-value', r.probPerGizmo).text(
					r.probPerGizmo > 0 ? Number(r.probPerGizmo * 100).toPrecision(4) + '%' : '0%'
				),
				$('<td>').attr('data-sort-value', r.probPerGizmo > 0 ? 1 / r.probPerGizmo : Number.MAX_VALUE).text(r.probPerGizmo > 0 ? '1/' + (1 / r.probPerGizmo).toFixed(2) : '-'),
				$('<td>').attr('data-sort-value', sortLevel).text(levelStr),
				$matCell,
				$('<td>').text(gizmoVariant),
				$('<td>').text(gizmoType),
				$costCell
			);
			$tr.data('columnToCell', [0, 1, 2, 3, 4, 5, 6, 7, 8]);
			return $tr;
		},

		// === Helpers ===

		computePerksByGizmo: function (rsPerks) {
			var result = { weapon: {}, armour: {}, tool: {} };
			for (var mat in rsPerks.comps) {
				['weapon', 'armour', 'tool'].forEach(function (gizmo) {
					var list = rsPerks.comps[mat][gizmo] || [];
					list.forEach(function (p) {
						result[gizmo][p.perk] = true;
					});
				});
			}
			return result;
		},

		getCompatiblePerks: function (perk1Name, perksByGizmo, rsPerks) {
			var perk1Gizmos = ['weapon', 'armour', 'tool'].filter(function (g) {
				return perksByGizmo[g][perk1Name];
			});
			var compatible = {};
			perk1Gizmos.forEach(function (g) {
				Object.keys(perksByGizmo[g]).forEach(function (p) {
					if (p === perk1Name || p === 'No effect') return;
					var pd = rsPerks.perks[p];
					if (!pd || !pd.ranks || pd.ranks.length === 0) return;
					if (pd.doubleslot) return;
					compatible[p] = true;
				});
			});
			return Object.keys(compatible).sort();
		},

		populateRankSelect: function (widget, perkData) {
			widget.clearItems();
			var items = perkData.ranks.map(function (r) {
				return new OO.ui.ButtonOptionWidget({ data: r.rank, label: String(r.rank) });
			});
			widget.addItems(items);
			if (items.length > 0) {
				widget.selectItemByData(perkData.ranks[perkData.ranks.length - 1].rank);
			}
		},

		formatLevels: function (levels) {
			if (!levels || levels.length === 0) return '-';
			var sorted = levels.slice().sort(function (a, b) { return a - b; });
			var ranges = [];
			var EN_DASH = '–';
			var start = sorted[0], end = sorted[0];
			for (var i = 1; i < sorted.length; i++) {
				if (sorted[i] === end + 1) {
					end = sorted[i];
				} else {
					ranges.push(start === end ? String(start) : start + EN_DASH + end);
					start = end = sorted[i];
				}
			}
			ranges.push(start === end ? String(start) : start + EN_DASH + end);
			return ranges.join(', ');
		},

		pickLinkLevel: function (r) {
			if (!r.bestLevels || !r.bestLevels.length) return null;
			var maxL = Math.max.apply(null, r.bestLevels);
			var minL = Math.min.apply(null, r.bestLevels);
			// No potions if 120 is included in range
			return (minL <= 120 && maxL >= 120) ? 120 : maxL;
		},

		// Build a result row
		buildCalcPerksUrl: function (r, level) {
			var slotKeys = ['middle', 'top', 'left', 'right', 'bottom',
				'top-left', 'top-right', 'bottom-left', 'bottom-right'];
			var qs = [];
			var gizmoCap = r.gizmoType.charAt(0).toUpperCase() + r.gizmoType.slice(1);
			qs.push('type=' + encodeURIComponent(gizmoCap));
			if (r.ancient) qs.push('ancient=true');
			if (level) {
				var lp = self.pickLevelAndPotion(level);
				qs.push('lvl=' + lp.level);
				if (lp.potion > 0) qs.push('p=' + lp.potion);
			}
			for (var i = 0; i < r.materials.length; i++) {
				if (r.materials[i]) {
					qs.push(slotKeys[i] + '=' + encodeURIComponent(r.materials[i]));
				}
			}
			return mw.util.getUrl('Calculator:Perks') + '#' + qs.join('&');
		},

		// Translate effective level into realistic base level + potion
		pickLevelAndPotion: function (effLevel) {
			if (effLevel <= 120) return { level: effLevel, potion: 0 };
			if (effLevel === 123) return { level: 120, potion: 1 };
			if (effLevel === 125) return { level: 120, potion: 2 };
			if (effLevel === 137) return { level: 120, potion: 3 };
			var base = effLevel - 17;
			if (base < 1) base = 1;
			if (base > 120) base = 120;
			return { level: base, potion: 3 };
		},

		parseTopResultKey: function (key) {
			if (!key) return [];
			var m = key.match(/^([\-A-Za-z' ]*?)(?: (\d))?(?:,([\-A-Za-z' ]*?)(?: (\d))?)?$/);
			if (!m) return [];
			var out = [];
			for (var i = 1; i < 4; i += 2) {
				if (m[i] === undefined) continue;
				if (!window.rsPerks.perks[m[i]]) continue;
				out.push({ name: m[i], rank: m[i + 1] });
			}
			// Returns [] if the key is empty / null.
			return out;
		},

		makePerkIconCell: function (topResultKey) {
			var $td = $('<td class="perk-background">');
			var parts = self.parseTopResultKey(topResultKey);
			parts.forEach(function (p) {
				var $img = $('<span class="perkCalcPerk">');
				$img.append($('<span class="perkCalcPerkImg">').attr('data-perk', p.name));
				if (p.rank !== undefined) {
					$img.append($('<span class="perkCalcRank">').addClass('data-rank-' + p.rank));
				}
				$td.append($img);
			});
			return $td;
		},

		makePerkLinkCell: function (topResultKey) {
			var $td = $('<td>');
			var parts = self.parseTopResultKey(topResultKey);
			parts.forEach(function (p, i) {
				var perkData = window.rsPerks.perks[p.name];
				var target = (perkData && perkData.link) ? perkData.link : p.name;
				var $a = $('<a>')
					.attr('href', 'https://runescape.wiki/w/' + target)
					.attr('target', '_blank')
					.attr('rel', 'noopener')
					.text(p.name + (p.rank !== undefined ? ' ' + p.rank : ''));
				if (i > 0) $td.append(', ');
				$td.append($a);
			});
			if (parts.length === 0) $td.text('-');
			return $td;
		},

		// From MediaWiki:Gadget-perkcalc-core.js
		extremeInventionPotion: function (level) {
			var potdata = [25, 30, 33, 36, 38, 40, 42, 43, 44, 45, 47, 48, 49, 49, 50, 51, 52, 10000000];
			for (var i = 0; i < potdata.length; i++) {
				if (level < potdata[i]) return i;
			}
			return 0;
		}
	};
	$(self.init);
}(jQuery, mediaWiki, rswiki));
// </nowiki>
