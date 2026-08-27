-- Headless JSON-RPC bridge for PathOfBuilding-PoE2's calculation engine.
--
-- Must be launched with cwd set to the vendored PathOfBuilding-PoE2/src directory
-- (its own dofile()/require() calls are relative to that path), e.g.:
--   lua.exe C:\...\pob-runtime\bridge.lua
--   (spawned with cwd = C:\...\pob-runtime\PathOfBuilding-PoE2\src)
--
-- Protocol: one JSON object per line on stdin -> one JSON object per line on stdout.
-- Request:  {"id": 1, "method": "get_stats", "params": {...}}
-- Response: {"id": 1, "result": {...}}  or  {"id": 1, "error": "message"}
-- All of PoB's own diagnostic output (print/ConPrintf) is redirected to stderr
-- so stdout carries only protocol frames.

local realPrint = print
_G.print = function(...)
	io.stderr:write(table.concat({ ... }, "\t"), "\n")
end

local json = dofile("../runtime/lua/dkjson.lua")

dofile("HeadlessWrapper.lua")
-- `build`, `loadBuildFromXML`, `newBuild` etc. are now globals, defined by HeadlessWrapper.lua

local function sanitizeForJson(value, depth)
	depth = depth or 0
	local t = type(value)
	if t == "number" or t == "string" or t == "boolean" then
		return value
	elseif t == "table" and depth < 3 then
		local out = {}
		local isArray = true
		local n = 0
		for k in pairs(value) do
			n = n + 1
			if type(k) ~= "number" then isArray = false end
		end
		if isArray and n > 0 then
			local arr = {}
			for i = 1, n do
				arr[i] = sanitizeForJson(value[i], depth + 1)
			end
			return arr
		end
		for k, v in pairs(value) do
			if type(k) == "string" then
				local sv = sanitizeForJson(v, depth + 1)
				if sv ~= nil then
					out[k] = sv
				end
			end
		end
		return out
	else
		return nil
	end
end

-- Every bridge method that parses raw item text goes through here rather than calling
-- `new("Item", text)` directly. Reason: PoB's own GUI (ItemsTab.lua) always calls
-- item:UpdateRunes() itself after constructing/displaying an item -- it's never done inside
-- Item:ParseRaw()/the constructor. Skipping it (as every bridge method originally did) means an
-- item's socketed runes get parsed into item.runes correctly but their stat lines never make it
-- into the calc engine at all -- confirmed via a live before/after diff where equipping the same
-- item with vs. without "Rune: Iron Rune" produced byte-identical stats. This silently
-- understated every equipped item that has runes socketed, not just the new rune-recommendation
-- methods, so it's fixed once here for every caller.
local function parseItemText(itemText)
	local ok, item = pcall(new, "Item", itemText)
	if ok and item and item.base then
		item:UpdateRunes()
	end
	return ok, item
end

-- Count of explicit build.calcsTab:BuildOutput() recomputes this bridge has driven (via
-- recomputeBuild below). A tree search's real cost is one recompute per candidate evaluation, so
-- the approach benchmark reports this as its machine-independent cost currency. reset_metrics
-- zeroes it at the start of a measured run; get_metrics reads it back.
local buildOutputCount = 0

-- The full "apply pending changes and recompute mainOutput" dance, in one place so every call
-- site is counted. buildFlag/modFlag + the OnFrame bracketing match what PoB's own GUI does
-- around a rebuild.
local function recomputeBuild()
	buildOutputCount = buildOutputCount + 1
	build.buildFlag = true
	build.modFlag = true
	runCallback("OnFrame")
	build.calcsTab:BuildOutput()
	runCallback("OnFrame")
end

local methods = {}

methods.ping = function(params)
	return "pong"
end

methods.get_metrics = function(params)
	return { buildOutputCount = buildOutputCount }
end

methods.reset_metrics = function(params)
	buildOutputCount = 0
	return { ok = true }
end

-- Starts a fresh default build (mainly useful for smoke-testing the bridge itself).
methods.new_build = function(params)
	newBuild()
	return { ok = true }
end

-- Loads a full PoB-PoE2 <PathOfBuilding2> build XML (e.g. read straight off disk
-- from the user's own PoB Builds folder).
methods.load_build_xml = function(params)
	if not params or not params.xml then
		error("load_build_xml requires params.xml")
	end
	loadBuildFromXML(params.xml, params.name or "bridge-build")
	if not build or not build.spec then
		error("build failed to load (invalid XML?)")
	end
	return { ok = true, className = build.spec.curClassName, level = build.characterLevel }
end

-- Returns the build's computed output stats (build.calcsTab.mainOutput),
-- flattened to scalar fields only (numbers/strings/booleans, shallow nested tables).
methods.get_stats = function(params)
	if not build or not build.calcsTab then
		error("no build loaded")
	end
	return sanitizeForJson(build.calcsTab.mainOutput)
end

-- Lists current slot -> equipped item name, for inspecting what's loaded.
methods.get_item_slots = function(params)
	if not build or not build.itemsTab then
		error("no build loaded")
	end
	local out = {}
	for slotName, slot in pairs(build.itemsTab.slots) do
		local item = build.itemsTab.items[slot.selItemId]
		out[slotName] = item and item.name or nil
	end
	return out
end

-- Every concrete equipment slot this item could legally go into (e.g. a Ring reports both
-- "Ring 1" and "Ring 2"; a Life Flask reports only "Flask 1", since PoB's own validity check
-- restricts Life/Mana flasks to their one matching slot). Uses build.itemsTab's own
-- IsItemValidForSlot -- the exact same check PoB's GUI uses to decide where an item can be
-- dropped -- rather than reimplementing per-type slot logic here. Excludes Jewel Socket and
-- weapon Swap slots: those are a different equip *context* (passive-tree jewels, an alternate
-- gear set) rather than another interchangeable instance of the same slot, which is what this
-- is for (letting the caller diff a candidate item against each real alternative it could
-- replace).
methods.get_valid_slots = function(params)
	if not params or not params.itemText then
		error("get_valid_slots requires params.itemText")
	end
	if not build or not build.itemsTab then
		error("no build loaded")
	end
	local ok, item = parseItemText(params.itemText)
	if not ok or not item or not item.base then
		error("could not parse item text: " .. tostring(item))
	end
	-- "Ring 3" exists in build.itemsTab.slots unconditionally (it's a static widget), but is only
	-- a real equip target for builds with a source of the AdditionalRingSlot mod (e.g. certain
	-- Uniques) -- mirrors the exact same flag check ItemsTab.lua's own slot.shown() uses to decide
	-- whether to show it in the GUI at all. IsItemValidForSlot alone doesn't know this; without
	-- this check every build would be offered a Ring 3 diff that does nothing.
	local hasThirdRingSlot = build.calcsTab and build.calcsTab.mainEnv
		and build.calcsTab.mainEnv.modDB:Flag(nil, "AdditionalRingSlot")

	local out = {}
	for slotName in pairs(build.itemsTab.slots) do
		if not slotName:match("Jewel Socket") and not slotName:match("Swap") and (slotName ~= "Ring 3" or hasThirdRingSlot) then
			if build.itemsTab:IsItemValidForSlot(item, slotName) then
				table.insert(out, slotName)
			end
		end
	end
	table.sort(out)
	return { slots = out }
end

-- Parses raw advanced-tooltip item text (as copied in-game) and equips it into
-- its primary slot (or an explicit params.slot override), then recomputes stats.
-- Returns the equipped slot name plus the recomputed get_stats() output.
methods.set_item = function(params)
	if not params or not params.itemText then
		error("set_item requires params.itemText")
	end
	if not build or not build.itemsTab then
		error("no build loaded")
	end
	local ok, item = parseItemText(params.itemText)
	if not ok or not item or not item.base then
		error("could not parse item text: " .. tostring(item))
	end
	build.itemsTab:AddItem(item, true)
	local slotName = params.slot or item:GetPrimarySlot()
	if not build.itemsTab.slots[slotName] then
		error("unknown slot: " .. tostring(slotName))
	end
	build.itemsTab.slots[slotName]:SetSelItemId(item.id)
	build.itemsTab:PopulateSlots()
	recomputeBuild()
	return {
		slot = slotName,
		itemName = item.name,
		stats = sanitizeForJson(build.calcsTab.mainOutput),
	}
end

-- Which boss's Desecration pool an exclusive mod belongs to, if any -- these tag names are
-- how PoB's own crafting-bench code (ItemsTab.lua's "DESECRATED" mod-list source) tells
-- boss-exclusive mods apart from the regular pool. "unveiled_mod" is a generic "this is
-- desecration-exclusive" tag that appears alongside a specific boss tag on most entries (e.g.
-- modTags = { "unveiled_mod", "kurgal_mod" }) -- checked last, as a fallback label only for
-- the few entries that don't carry one of the three specific boss tags.
local SPECIFIC_BOSS_TAGS = { ulaman_mod = "Ulaman", amanamu_mod = "Amanamu", kurgal_mod = "Kurgal" }

local function desecratedBossOf(mod)
	local isDesecrated = false
	for _, tag in ipairs(mod.modTags or {}) do
		if SPECIFIC_BOSS_TAGS[tag] then
			return SPECIFIC_BOSS_TAGS[tag]
		end
		if tag == "unveiled_mod" then
			isDesecrated = true
		end
	end
	return isDesecrated and "Unveiled" or nil
end

-- Extracts just the array-indexed stat-line-template strings off a mod definition table
-- (mod.affix/.group/.weightKey/etc are all string-keyed, so sanitizeForJson's mixed-key
-- table would otherwise silently drop these numeric-indexed entries -- see its isArray check).
local function modStatLines(mod)
	local lines = {}
	for i = 1, #mod do
		lines[i] = mod[i]
	end
	return lines
end

-- Given a candidate item's raw text (already captured, e.g. via the in-game advanced-tooltip
-- copy hotkey), returns which prefix/suffix slots are still open and, for each, every legal
-- mod that could fill it -- filtered by base-category weight (item:GetModSpawnWeight, PoB's
-- own real spawn-weight calculation) and by not colliding with a mod group already on the
-- item. Also returns which of those mods an Essence guarantees, and which are Desecration-
-- exclusive (with the boss whose pool grants them, where determinable).
--
-- Relies on item.prefixes/item.suffixes being populated, which only happens when the parsed
-- text includes PoE2's "{ Prefix Modifier "X" ... }" bracket tags (real in-game clipboard
-- format) -- see parseItem.ts's tag-preservation comment. Items parsed from PoB's own
-- build-XML format (no tags) will report every slot as open and may recommend a mod whose
-- group is already present -- that format is only used today for reading already-equipped
-- gear, not for evaluating a newly captured item, so this is an accepted gap for now.
methods.list_candidate_mods = function(params)
	if not params or not params.itemText then
		error("list_candidate_mods requires params.itemText")
	end
	local ok, item = parseItemText(params.itemText)
	if not ok or not item or not item.base then
		error("could not parse item text: " .. tostring(item))
	end

	-- item.prefixes/item.suffixes are padded with {modId="None"} placeholders up to the
	-- item's affix limit (see ItemClass:ParseRaw's post-crafted-detection padding loop) --
	-- #item.prefixes is therefore always the *limit*, not the filled count, so open slots and
	-- occupied groups both need to skip "None" entries explicitly.
	local existingGroups = { Prefix = {}, Suffix = {} }
	local filledPrefixes, filledSuffixes = 0, 0
	for _, entry in ipairs(item.prefixes or {}) do
		if entry.modId and entry.modId ~= "None" then
			filledPrefixes = filledPrefixes + 1
			local mod = item.affixes and item.affixes[entry.modId]
			if mod and mod.group then existingGroups.Prefix[mod.group] = true end
		end
	end
	for _, entry in ipairs(item.suffixes or {}) do
		if entry.modId and entry.modId ~= "None" then
			filledSuffixes = filledSuffixes + 1
			local mod = item.affixes and item.affixes[entry.modId]
			if mod and mod.group then existingGroups.Suffix[mod.group] = true end
		end
	end

	local prefixLimit = (item.prefixes and item.prefixes.limit) or ((item.affixLimit or 0) / 2)
	local suffixLimit = (item.suffixes and item.suffixes.limit) or ((item.affixLimit or 0) / 2)

	-- A Normal or Magic item isn't stuck at 0 or 1+1 affixes forever -- an Orb of Alchemy or
	-- Regal Orb (currency, not a drop) upgrades it straight to Rare's 3 prefix + 3 suffix cap
	-- (2+2 for non-Abyss Jewels; mirrors ParseRaw's own RARE-branch formula in Item.lua, which
	-- isn't itemLevel-dependent in this PoB-PoE2 build). Without this, list_candidate_mods
	-- reports 0 open slots the moment a Magic item's 1+1 is filled, which reads as "nothing can
	-- be added" when in fact currency unlocks 4 more slots -- reporting the *projected* Rare
	-- slot count instead (still honest about needing that upgrade first, via
	-- rarityUpgradeNeeded below) is what actually answers "what could this item become."
	-- PoB's own parser doesn't reject an explicit mod count above a Magic/Normal item's nominal
	-- cap (confirmed by reading ParseRaw: the cap is never enforced against the parsed affix
	-- list, only used to pad self.prefixes/self.suffixes for crafted-item UI dropdowns), so
	-- craft_candidate_mod needs no matching change -- it'll add and measure the mod exactly as
	-- it does for an already-Rare item.
	local rarityUpgradeNeeded = nil
	if item.rarity == "NORMAL" or item.rarity == "MAGIC" then
		local rareAffixLimit = (item.type == "Jewel" and not (item.base.subType == "Abyss" and item.corrupted)) and 4 or 6
		prefixLimit = rareAffixLimit / 2
		suffixLimit = rareAffixLimit / 2
		rarityUpgradeNeeded = item.rarity == "NORMAL" and "Orb of Alchemy" or "Regal Orb"
	end

	local openPrefixSlots = math.max(prefixLimit - filledPrefixes, 0)
	local openSuffixSlots = math.max(suffixLimit - filledSuffixes, 0)
	local itemLevel = item.itemLevel or 100

	local function collectRegular(modType, openSlots)
		local out = {}
		if openSlots > 0 and item.affixes then
			for modId, mod in pairs(item.affixes) do
				if mod.type == modType and not existingGroups[modType][mod.group] and (not mod.level or mod.level <= itemLevel) then
					local weight = item:GetModSpawnWeight(mod)
					if weight > 0 then
						table.insert(out, {
							id = modId,
							affix = mod.affix,
							group = mod.group,
							lines = modStatLines(mod),
							level = mod.level,
							weight = weight,
							modTags = mod.modTags,
						})
					end
				end
			end
		end
		return out
	end

	local prefixCandidates = collectRegular("Prefix", openPrefixSlots)
	local suffixCandidates = collectRegular("Suffix", openSuffixSlots)

	local essenceCandidates = {}
	if data.essences then
		local itemType = (item.type == "Staff" and item.base.subType) or item.type
		for _, essence in pairs(data.essences) do
			local modId = essence.mods and essence.mods[itemType]
			if modId then
				local mod = (item.affixes and item.affixes[modId]) or (data.itemMods.Exclusive and data.itemMods.Exclusive[modId])
				if mod then
					-- Some essence-exclusive mods (e.g. the "+X to Str/Dex/Int" display combo mods)
					-- have no .type field at all in PoB's own data -- mirrors ItemsTab.lua's own
					-- essence-list display, which uses this exact "(mod.type or "Suffix")" fallback.
					table.insert(essenceCandidates, {
						essenceName = essence.name,
						modId = modId,
						affix = mod.affix,
						group = mod.group,
						type = mod.type or "Suffix",
						lines = modStatLines(mod),
					})
				end
			end
		end
	end

	local desecratedCandidates = {}
	if data.itemMods.Desecrated then
		for modId, mod in pairs(data.itemMods.Desecrated) do
			local boss = desecratedBossOf(mod)
			if boss and (mod.type == "Prefix" or mod.type == "Suffix") and item:GetModSpawnWeight(mod) > 0
				and (not mod.level or mod.level <= itemLevel) then
				table.insert(desecratedCandidates, {
					id = modId,
					affix = mod.affix,
					group = mod.group,
					type = mod.type,
					lines = modStatLines(mod),
					level = mod.level,
					boss = boss,
				})
			end
		end
	end

	return {
		openPrefixSlots = openPrefixSlots,
		openSuffixSlots = openSuffixSlots,
		prefixCandidates = prefixCandidates,
		suffixCandidates = suffixCandidates,
		essenceCandidates = essenceCandidates,
		desecratedCandidates = desecratedCandidates,
		rarityUpgradeNeeded = rarityUpgradeNeeded,
	}
end

-- Adds one candidate mod (by id, as returned from list_candidate_mods) onto an item as a new
-- explicit affix line, the same way PoB's own "Craft" bench button does for its
-- PREFIX/SUFFIX/ESSENCE/DESECRATED sources (ItemsTab.lua's addModifier()) -- just without the
-- GUI. Returns the crafted item's raw text; callers equip it via the existing set_item method
-- (which also does the recompute), rather than duplicating that logic here.
methods.craft_candidate_mod = function(params)
	if not params or not params.itemText or not params.modId then
		error("craft_candidate_mod requires params.itemText and params.modId")
	end
	local ok, item = parseItemText(params.itemText)
	if not ok or not item or not item.base then
		error("could not parse item text: " .. tostring(item))
	end
	local mod = (item.affixes and item.affixes[params.modId])
		or (data.itemMods.Exclusive and data.itemMods.Exclusive[params.modId])
		or (data.itemMods.Desecrated and data.itemMods.Desecrated[params.modId])
	if not mod then
		error("unknown modId: " .. tostring(params.modId))
	end
	-- Mirrors ItemsTab.lua's addModifier() (the GUI "Craft" button): the flag key here is a
	-- constant ("custom"), not mod.type -- mod.type is "Prefix"/"Suffix" and is sometimes nil
	-- on Desecrated-pool entries, which would crash `[mod.type] = true` with a nil table index.
	for i = 1, #mod do
		table.insert(item.explicitModLines, { line = mod[i], modTags = mod.modTags, custom = true })
	end
	item:BuildAndParseRaw()
	return { itemText = item:BuildRaw() }
end

-- Classifies each requested candidate mod's real PoB calc-modifier type (BASE/INC/MORE/FLAG/...)
-- by running its stat-line templates through modLib.parseMod -- the SAME parser Item.lua/
-- ItemsTab.lua use to turn a raw mod line into calc Mod objects (ModTools.lua's
-- `modLib.parseMod, modLib.parseModCache = LoadModule("Modules/ModParser", launch)`), rather than
-- guessing from the displayed English text (tried that first as a static classifier against
-- ModItem.lua's raw data -- it silently miscounted every "+X% to Fire Resistance" line as a
-- percentage-multiplier mod instead of the flat-additive one it actually is).
--
-- A candidate's mod[i] stat lines are UNRESOLVED range templates, e.g. "+(5-8) to Strength" --
-- modLib.parseMod can't parse the literal "(5-8)" (confirmed live: it silently failed on every
-- single candidate, including trivial ones like "(3-7)% increased Fire Damage", until this was
-- caught). Item.lua resolves that same template shape via itemLib.applyRange(line, range, ...)
-- before ever handing a line to modLib.parseMod (see the unnamed local helper right above
-- ItemClass's constructor, and writeModLine's displayValueScalar branch) -- so this method mirrors
-- that exact step, resolving at a fixed mid-roll (range = 0.5) purely to get a representative
-- concrete value to classify, not to predict the actual roll a player would get.
--
-- Doesn't require build/item context beyond parsing itemText for the modId lookup (mirrors
-- craft_candidate_mod's own item.affixes/[Exclusive]/[Desecrated] lookup) -- purely a text-in,
-- structured-data-out classification, no recompute, so it's meant to be called once per
-- candidate pool (all ~150-270 candidates in one round trip) rather than per candidate.
local MID_ROLL = 0.5
methods.classify_candidate_mods = function(params)
	if not params or not params.itemText or not params.modIds then
		error("classify_candidate_mods requires params.itemText and params.modIds")
	end
	local ok, item = parseItemText(params.itemText)
	if not ok or not item or not item.base then
		error("could not parse item text: " .. tostring(item))
	end
	local out = {}
	for _, modId in ipairs(params.modIds) do
		local mod = (item.affixes and item.affixes[modId])
			or (data.itemMods.Exclusive and data.itemMods.Exclusive[modId])
			or (data.itemMods.Desecrated and data.itemMods.Desecrated[modId])
		if not mod then
			error("unknown modId: " .. tostring(modId))
		end
		local parsedMods = {}
		local fullyResolved = true
		for i = 1, #mod do
			local resolvedLine = itemLib.applyRange(mod[i], MID_ROLL)
			local modList, extra = modLib.parseMod(resolvedLine)
			-- extra is any leftover unparsed text; a non-empty extra (or no modList at all) means
			-- this stat line didn't fully resolve into real calc Mod objects -- same signal
			-- ModParser.lua's own unsupported-mod logging uses.
			if not modList or (extra and #extra > 0) then
				fullyResolved = false
			end
			if modList then
				for _, m in ipairs(modList) do
					table.insert(parsedMods, {
						-- m.name is usually one stat name, but combined-stat mods (e.g. "+X to
						-- Life and Mana") give a table of names -- flatten both to a JSON array.
						names = type(m.name) == "table" and m.name or { m.name },
						calcType = m.type,
						value = m.value,
					})
				end
			end
		end
		table.insert(out, {
			modId = modId,
			parsedMods = parsedMods,
			fullyResolved = fullyResolved,
		})
	end
	return { results = out }
end

-- Given a candidate item's raw text, returns its rune-socket count/fill state and every rune
-- legally usable in an open socket, using the same base/specific-type resolution PoB's own
-- Item:UpdateRunes()/GetSocketedAugmentTypes() use to decide which of a rune's per-category
-- stat blocks actually apply to this item (e.g. a rune might grant one stat block to all
-- "weapon"s and an extra one specifically to "sword"s -- both apply here, matching the game).
--
-- Deliberately excludes data.itemMods.Runes entries whose matched category has type ==
-- "SoulCore": those aren't placed in the "S" rune sockets this method measures (item.sockets /
-- item.itemSocketCount) but through a separate, not-modeled-here mechanism
-- (self.socketedSoulCoreTypes) -- recommending one here would suggest something the player
-- can't actually socket into an open rune slot.
methods.list_candidate_runes = function(params)
	if not params or not params.itemText then
		error("list_candidate_runes requires params.itemText")
	end
	local ok, item = parseItemText(params.itemText)
	if not ok or not item or not item.base then
		error("could not parse item text: " .. tostring(item))
	end

	local filledRuneSockets = 0
	for i = 1, item.itemSocketCount do
		if item.runes[i] and item.runes[i] ~= "None" then
			filledRuneSockets = filledRuneSockets + 1
		end
	end
	local openRuneSockets = math.max(item.itemSocketCount - filledRuneSockets, 0)

	local baseType, specificType = item:GetSocketedAugmentTypes()
	local candidates = {}
	if openRuneSockets > 0 and data.itemMods.Runes then
		for runeName, rune in pairs(data.itemMods.Runes) do
			local lines = {}
			for _, categoryKey in ipairs({ baseType, specificType }) do
				local block = categoryKey and rune[categoryKey]
				if block and block.type == "Rune" then
					for i = 1, #block do
						table.insert(lines, block[i])
					end
				end
			end
			if #lines > 0 then
				table.insert(candidates, { name = runeName, lines = lines })
			end
		end
	end

	return {
		runeSocketCount = item.itemSocketCount,
		filledRuneSockets = filledRuneSockets,
		openRuneSockets = openRuneSockets,
		candidates = candidates,
	}
end

-- Places one named rune (as returned from list_candidate_runes) into the item's first open
-- socket. Returns the crafted item's raw text; callers equip it via the existing set_item
-- method, same pattern as craft_candidate_mod.
methods.craft_candidate_rune = function(params)
	if not params or not params.itemText or not params.runeName then
		error("craft_candidate_rune requires params.itemText and params.runeName")
	end
	local ok, item = parseItemText(params.itemText)
	if not ok or not item or not item.base then
		error("could not parse item text: " .. tostring(item))
	end
	local targetIndex = nil
	for i = 1, item.itemSocketCount do
		if not item.runes[i] or item.runes[i] == "None" then
			targetIndex = i
			break
		end
	end
	if not targetIndex then
		error("no open rune socket on this item")
	end
	-- BuildRaw() serializes "Rune: <name>" straight from item.runes per socket index -- no need
	-- to also call UpdateRunes() here, since the subsequent set_item() call fully re-parses this
	-- returned text (including recomputing rune-granted stat lines) from scratch anyway.
	item.runes[targetIndex] = params.runeName
	return { itemText = item:BuildRaw() }
end

-- Given a candidate item's raw text, returns the pool of Corrupted-implicit mods a Vaal Orb
-- could add to it -- filtered by base-category weight the same way list_candidate_mods filters
-- prefix/suffix candidates (item:GetModSpawnWeight). Source data is data.itemMods.Corruption
-- (Data/ModCorrupted.lua, GGG's own auto-generated mod file, so patch-current), which is only
-- the "add a Corrupted implicit" outcome -- a Vaal Orb has several *other* possible outcomes
-- (reroll an existing mod's numeric value, add/remove a socket, do nothing, etc: see
-- ItemsTab.lua's CorruptDisplayItem, whose own comment flags the outcome *selection* logic as
-- an unported PoE1 carryover) that this method deliberately does not model or claim odds for --
-- it only answers "what could the implicit be if that's the outcome you get," not "how likely
-- is any given outcome." Deliberately excludes the separate "SpecialCorrupted" mod type (a
-- handful of always-available entries with no weightKey/weightVal to filter by at all -- PoB's
-- own GUI only offers them under a distinct source picker, not blended with the weighted pool)
-- since there's no real per-item eligibility signal to filter them by here.
methods.list_candidate_corruption_mods = function(params)
	if not params or not params.itemText then
		error("list_candidate_corruption_mods requires params.itemText")
	end
	local ok, item = parseItemText(params.itemText)
	if not ok or not item or not item.base then
		error("could not parse item text: " .. tostring(item))
	end

	local candidates = {}
	if item.corruptible and not item.corrupted and data.itemMods.Corruption then
		for modId, mod in pairs(data.itemMods.Corruption) do
			if mod.type == "Corrupted" then
				local weight = item:GetModSpawnWeight(mod)
				if weight > 0 then
					table.insert(candidates, {
						id = modId,
						affix = mod.affix,
						group = mod.group,
						lines = modStatLines(mod),
						weight = weight,
						modTags = mod.modTags,
					})
				end
			end
		end
	end

	return {
		corruptible = item.corruptible or false,
		alreadyCorrupted = item.corrupted or false,
		candidates = candidates,
	}
end

-- Passive tree points used/available, mirroring Build.lua's own EstimatePlayerProgress calc
-- (the exact formula that drives its real "X / Y" points-used display): usedMax = 99 +
-- build.maxWeaponSets + ExtraPoints.
--
-- build.maxWeaponSets is a misleadingly-named field in this PoB-PoE2 fork -- despite the name,
-- it holds the *cumulative total of quest-reward passive points* across every act
-- (Build.lua:98: `self.maxWeaponSets = self.acts[self.maxActs].questPoints`, itself a running
-- sum built from Data/QuestRewards.lua's per-quest questPoints), not a weapon-swap-branch
-- count. Confirmed live: every one of this project's own sample builds showed pointsUsed
-- exceeding a naive "99 + ExtraPoints" cap by roughly its quest-point total, until this term
-- was included. Skipping it looks like "this build is over its point budget" when it isn't.
methods.get_tree_status = function(params)
	if not build or not build.spec then
		error("no build loaded")
	end
	local used, ascUsed, secondaryAscUsed = build.spec:CountAllocNodes()
	local extra = (build.calcsTab and build.calcsTab.mainOutput and build.calcsTab.mainOutput.ExtraPoints) or 0
	local questPoints = build.maxWeaponSets or 0
	return {
		pointsUsed = used,
		pointsMax = 99 + questPoints + extra,
		ascendancyPointsUsed = ascUsed,
		ascendancyPointsMax = 8,
		secondaryAscendancyPointsUsed = secondaryAscUsed,
		secondaryAscendancyPointsMax = 8,
	}
end

-- Every unallocated node that's currently connectable at all (node.path ~= nil, i.e. within
-- reach of the tree as currently allocated) -- the candidate pool evaluate_candidate_nodes
-- gets called against. Cheap: just a filter over spec.nodes, no alloc/recompute. Excludes
-- ClassStart/AscendClassStart (never a real allocation target, just tree anchors).
--
-- pathLength = #node.path is the number of points AllocNode would actually spend to connect
-- this node from the current tree (the candidate itself plus every intermediate path node it
-- drags in). It's the same shared node.path cache evaluate_candidate_nodes documents as
-- BuildAllDependsAndPaths()-dependent, but here we only *read* its current length and never
-- alloc, so no rebuild discipline is needed -- it reflects the tree exactly as loaded. A
-- frontier-adjacent node reads 1; a distant notable reads > 5. Beam search uses it for
-- proximity gating (only expand candidates within K path-points of the current frontier).
--
-- opts.types (array of type strings) and opts.maxPathLength (number) filter server-side, purely
-- to shrink the payload -- a real tree has ~3800 reachable nodes and list_allocatable_nodes_from
-- is called once per search step. nil opts = no filtering.
local function enumerateAllocatable(opts)
	local typeSet
	if opts and opts.types then
		typeSet = {}
		for _, t in ipairs(opts.types) do
			typeSet[t] = true
		end
	end
	local maxPathLength = opts and opts.maxPathLength
	local out = {}
	for id, node in pairs(build.spec.nodes) do
		if not node.alloc and node.path and node.type ~= "ClassStart" and node.type ~= "AscendClassStart"
			and (not typeSet or typeSet[node.type])
			and (not maxPathLength or #node.path <= maxPathLength) then
			table.insert(out, {
				id = id,
				name = node.dn,
				type = node.type,
				statLines = node.sd or {},
				ascendancyName = node.ascendancyName,
				pathLength = #node.path,
			})
		end
	end
	return out
end

methods.list_allocatable_nodes = function(params)
	if not build or not build.spec then
		error("no build loaded")
	end
	return { nodes = enumerateAllocatable(params) }
end

-- Same enumeration, but for the tree with params.allocSet allocated on top of the loaded
-- baseline -- so pathLength is measured from that partial-allocation frontier, not the loaded
-- one (a node the seed just made adjacent now reads 1). Allocates the set, rebuilds the path
-- cache once, enumerates, rolls back. No BuildOutput -- this only touches spec/paths, so it's
-- cheap enough to call once per beam step. params.types / params.maxPathLength filter as above.
methods.list_allocatable_nodes_from = function(params)
	if not params or not params.allocSet then
		error("list_allocatable_nodes_from requires params.allocSet")
	end
	if not build or not build.spec then
		error("no build loaded")
	end
	local spec = build.spec
	-- This method never reads mainOutput and does no BuildOutput; snapshot build.buildFlag so the
	-- AllocNode calls below don't leave a spurious rebuild pending (nor suppress a real one).
	local buildFlagBefore = build.buildFlag
	local undo = spec:CreateUndoState()
	for _, allocId in ipairs(params.allocSet) do
		local allocNode = spec.nodes[allocId]
		if not allocNode then
			error("unknown allocSet nodeId: " .. tostring(allocId))
		end
		spec:AllocNode(allocNode)
	end
	spec:BuildAllDependsAndPaths()

	local nodes = enumerateAllocatable(params)

	spec:RestoreUndoState(undo)
	spec:BuildAllDependsAndPaths()
	build.buildFlag = buildFlagBefore
	return { nodes = nodes }
end

-- For each candidate node id: allocate it (spec:AllocNode auto-paths from the nearest
-- allocated node, possibly pulling in several intermediate nodes to connect a distant one),
-- recompute, capture stats + the real point cost, then roll back before the next candidate.
--
-- Rollback uses spec:CreateUndoState()/RestoreUndoState() -- PoB's own real Ctrl+Z mechanism
-- -- rather than a hand-rolled DeallocNode(node) cascade. DeallocNode only cascades to
-- *dependent* (downstream) nodes; it does not undo the upstream path nodes AllocNode may have
-- silently pulled in to connect a distant candidate. Repeatedly evaluating candidates via
-- DeallocNode alone would leak those stray path nodes into every subsequent candidate's
-- baseline. CreateUndoState/RestoreUndoState round-trips through spec:ImportFromNodeList,
-- which is guaranteed correct for this because it's the same mechanism the GUI's own undo
-- system relies on.
--
-- One subtlety this depends on: node.path is a shared, mutable cache on each node table,
-- last written by whichever BuildAllDependsAndPaths() call ran most recently. AllocNode's own
-- call to it at the end of allocating candidate N overwrites .path on every node in the tree
-- (including every *other* candidate still queued), reflecting a tree state that includes
-- candidate N -- even though RestoreUndoState immediately afterward reverts allocNodes/alloc
-- flags back to baseline. Without an explicit rebuild after restore, candidate N+1 would
-- allocate using a stale path computed against the wrong tree. Hence the explicit
-- spec:BuildAllDependsAndPaths() call after every restore, before the next candidate.
--
-- One JSON-RPC round trip evaluates the whole batch -- this, not transport speed, is what
-- keeps a tree search from costing one round trip per candidate.
--
-- Shared core of evaluate_candidate_nodes (allocSet = nil/{}) and evaluate_candidate_nodes_from
-- (allocSet = a partial allocation to lay down first). When allocSet is non-empty the whole
-- batch is wrapped in one extra CreateUndoState/RestoreUndoState: allocate every allocSet node,
-- rebuild paths once so the per-candidate loop's node.path cache reflects the augmented tree,
-- run the loop (each candidate now rolls back to the allocSet state, not the loaded baseline --
-- so a beam node's candidates are measured against that beam node's stats), then restore the
-- loaded baseline and rebuild paths a final time. With an empty allocSet this is byte-for-byte
-- the original per-candidate-only path (no outer undo, no extra rebuild).
local function evaluateCandidatesAgainst(nodeIds, allocSet)
	local spec = build.spec
	local outerUndo
	if allocSet and #allocSet > 0 then
		outerUndo = spec:CreateUndoState()
		for _, allocId in ipairs(allocSet) do
			local allocNode = spec.nodes[allocId]
			if not allocNode then
				error("unknown allocSet nodeId: " .. tostring(allocId))
			end
			spec:AllocNode(allocNode)
		end
		spec:BuildAllDependsAndPaths()
	end

	local results = {}
	for _, nodeId in ipairs(nodeIds) do
		local node = spec.nodes[nodeId]
		if not node then
			error("unknown nodeId: " .. tostring(nodeId))
		end
		local usedBefore, ascUsedBefore = spec:CountAllocNodes()
		local undo = spec:CreateUndoState()

		spec:AllocNode(node)
		recomputeBuild()

		local usedAfter, ascUsedAfter = spec:CountAllocNodes()
		table.insert(results, {
			nodeId = nodeId,
			pointsSpent = usedAfter - usedBefore,
			ascendancyPointsSpent = ascUsedAfter - ascUsedBefore,
			stats = sanitizeForJson(build.calcsTab.mainOutput),
		})

		spec:RestoreUndoState(undo)
		spec:BuildAllDependsAndPaths()
	end

	if outerUndo then
		spec:RestoreUndoState(outerUndo)
		spec:BuildAllDependsAndPaths()
		-- The per-candidate loop leaves build.calcsTab.mainOutput reflecting the last candidate
		-- (allocSet + that candidate), not the restored baseline -- RestoreUndoState only reverts
		-- the passive spec, not the calc output. evaluate_candidate_nodes tolerates that because
		-- its only caller reads get_stats *before* evaluating; evaluate_candidate_nodes_from is
		-- called repeatedly by the beam driver, and the next call's CreateUndoState must capture a
		-- clean baseline, so recompute once here to resync mainOutput with the reverted tree.
		recomputeBuild()
	end
	return results
end

methods.evaluate_candidate_nodes = function(params)
	if not params or not params.nodeIds then
		error("evaluate_candidate_nodes requires params.nodeIds")
	end
	if not build or not build.spec or not build.calcsTab then
		error("no build loaded")
	end
	return { results = evaluateCandidatesAgainst(params.nodeIds, nil) }
end

-- Like evaluate_candidate_nodes, but each candidate is measured on top of `params.allocSet` --
-- a list of node ids representing a partial allocation the caller has built on the loaded
-- baseline (a beam-search node). pointsSpent/ascendancyPointsSpent are the candidate's marginal
-- cost *over* that partial allocation. The build is left exactly as loaded afterwards, so a
-- fresh get_stats matches the original baseline (round-trip determinism, per docs/gotchas.md).
-- evaluate_candidate_nodes_from({ allocSet = {}, nodeIds = ids }) is identical to
-- evaluate_candidate_nodes({ nodeIds = ids }).
methods.evaluate_candidate_nodes_from = function(params)
	if not params or not params.nodeIds or not params.allocSet then
		error("evaluate_candidate_nodes_from requires params.allocSet and params.nodeIds")
	end
	if not build or not build.spec or not build.calcsTab then
		error("no build loaded")
	end
	return { results = evaluateCandidatesAgainst(params.nodeIds, params.allocSet) }
end

-- Stats of the build with `params.allocSet` (a list of node ids) allocated on top of the loaded
-- baseline, plus the real point cost of that whole set (candidate ids + every path node AllocNode
-- drags in to connect them). Rolls back to the loaded baseline and resyncs mainOutput, same
-- discipline as evaluate_candidate_nodes_from. This is how the beam driver reads a beam node's
-- own stats -- to score it, and to judge its candidates' constraints against it -- and how repair
-- prices a seed node by measuring the set with that node left out. An empty allocSet returns the
-- loaded baseline (pointsSpent 0).
methods.get_stats_from = function(params)
	if not params or not params.allocSet then
		error("get_stats_from requires params.allocSet")
	end
	if not build or not build.spec or not build.calcsTab then
		error("no build loaded")
	end
	local spec = build.spec
	local usedBefore, ascUsedBefore = spec:CountAllocNodes()
	local undo = spec:CreateUndoState()
	for _, allocId in ipairs(params.allocSet) do
		local allocNode = spec.nodes[allocId]
		if not allocNode then
			error("unknown allocSet nodeId: " .. tostring(allocId))
		end
		spec:AllocNode(allocNode)
	end
	spec:BuildAllDependsAndPaths()
	recomputeBuild()

	local usedAfter, ascUsedAfter = spec:CountAllocNodes()
	local out = {
		pointsSpent = usedAfter - usedBefore,
		ascendancyPointsSpent = ascUsedAfter - ascUsedBefore,
		stats = sanitizeForJson(build.calcsTab.mainOutput),
	}

	spec:RestoreUndoState(undo)
	spec:BuildAllDependsAndPaths()
	recomputeBuild()
	return out
end

-- Main dispatch loop: newline-delimited JSON-RPC over stdin/stdout.
while true do
	local line = io.read("*l")
	if not line then break end
	if line ~= "" then
		local request, _, decodeErr = json.decode(line)
		if not request then
			io.write(json.encode({ error = "invalid JSON: " .. tostring(decodeErr) }), "\n")
		else
			local handler = methods[request.method]
			if not handler then
				io.write(json.encode({ id = request.id, error = "unknown method: " .. tostring(request.method) }), "\n")
			else
				local ok, result = pcall(handler, request.params)
				if ok then
					io.write(json.encode({ id = request.id, result = result }), "\n")
				else
					io.write(json.encode({ id = request.id, error = tostring(result) }), "\n")
				end
			end
		end
		io.flush()
	end
end
