import {
    ExtraButtonComponent,
    ItemView,
    Modal,
    Notice,
    Platform,
    Setting,
    WorkspaceLeaf
} from "obsidian";
import {
    BASE,
    CREATURE,
    CREATURE_TRACKER_VIEW,
    INTIATIVE_TRACKER_VIEW
} from "./utils";

import type InitiativeTracker from "./main";

import App from "./svelte/App.svelte";
import { Creature } from "./utils/creature";
import type {
    Condition,
    HomebrewCreature,
    InitiativeViewState,
    Party,
    TrackerEvents,
    TrackerViewState
} from "@types";
import { equivalent } from "./encounter";
import {OVERFLOW_TYPE} from "./utils/constants"

class LoadEncounterModal extends Modal {
    constructor(public plugin: InitiativeTracker) {
        super(plugin.app);
    }
    onOpen() {
        this.titleEl.setText("Load Encounter");

        for (const encounter of Object.values(this.plugin.data.encounters)) {
            new Setting(this.contentEl).setName(encounter.name);
        }
    }
}

export default class TrackerView extends ItemView {
    async saveEncounter(name: string) {
        if (!name) {
            new Notice("An encounter must have a name to be saved.");
            return;
        }
        this.plugin.data.encounters[name] = {
            creatures: [...this.ordered.map((c) => c.toJSON())],
            state: this.state,
            name,
            round: this.round
        };
        await this.plugin.saveSettings();
    }
    async loadEncounter(name: string) {
        const state = this.plugin.data.encounters[name];
        if (!state) {
            new Notice("There was an issue loading the encounter.");
            return;
        }
        this.newEncounterFromState(state);
    }
    toggleCondensed() {
        this.condense = !this.condense;
        this.setAppState({ creatures: this.ordered });
    }
    setCondensed(bool: boolean) {
        this.condense = bool;
        this.setAppState({ creatures: this.ordered });
    }
    async openCombatant(creature: Creature) {
        const view = this.plugin.combatant;
        if (!view) {
            const leaf = this.app.workspace.getRightLeaf(true);
            await leaf.setViewState({
                type: CREATURE_TRACKER_VIEW
            });
        }
        this.ordered.forEach((c) => (c.viewing = false));
        creature.viewing = true;
        this.setAppState({ creatures: this.ordered });
        const ref = this.app.workspace.on(
            "initiative-tracker:stop-viewing",
            () => {
                creature.viewing = false;
                this.setAppState({ creatures: this.ordered });
                this.app.workspace.offref(ref);
            }
        );
        this.registerEvent(ref);

        this.plugin.combatant.render(creature);
    }
    protected creatures: Creature[] = [];

    public state: boolean = false;

    public name: string;

    public condense = this.plugin.data.condense;

    public round: number = 1;

    private _app: App;
    private _rendered: boolean = false;

    get pcs() {
        return this.players;
    }
    get npcs() {
        return this.creatures.filter((c) => !c.player);
    }
    party: Party = this.plugin.defaultParty;
    async switchParty(party: string) {
        if (!this.plugin.data.parties.find((p) => p.name == party)) return;
        this.party = this.plugin.data.parties.find((p) => p.name == party);
        console.log("🚀 ~ file: view.ts ~ line 120 ~ this.party", this.party);
        this.setAppState({ party: this.party.name });
        this.creatures = this.creatures.filter((p) => !p.player);
        for (const player of this.players) {
            player.initiative = await this.getInitiativeValue(player.modifier);
            this._addCreature(player);
        }
    }
    playerNames: string[] = [];
    get players() {
        if (this.party) {
            let players = this.party.players;
            if (players) {
                return Array.from(this.plugin.playerCreatures.values()).filter(
                    (p) => players.includes(p.name)
                );
            }
        }
        return Array.from(this.plugin.playerCreatures.values());
    }

    updatePlayers() {
        this.trigger("initiative-tracker:players-updated", this.pcs);
        this.setAppState({
            creatures: this.ordered
        });
    }

    updateState() {
        this.setAppState(this.appState);
    }

    constructor(public leaf: WorkspaceLeaf, public plugin: InitiativeTracker) {
        super(leaf);
        if (this.plugin.data.state?.creatures?.length) {
            this.newEncounterFromState(this.plugin.data.state);
        } else {
            this.newEncounter();
        }
    }
    newEncounterFromState(initiativeState: InitiativeViewState) {
        if (!initiativeState || !initiativeState?.creatures?.length) {
            this.newEncounter();
        }
        const { creatures, state, name, round = 1 } = initiativeState;
        this.setCreatures([...creatures.map((c) => Creature.fromJSON(c))]);

        this.name = name;
        this.round = round;
        this.state = state;
        this.trigger("initiative-tracker:new-encounter", this.appState);

        this.setAppState({
            creatures: this.ordered,
            state: this.state,
            round: this.round,
            name: this.name
        });
    }
    private _addCreature(creature: Creature) {
        this.addCreatures([creature], false);
        /* this.creatures.push(creature);

        this.setAppState({
            creatures: this.ordered
        }); */
    }
    get condensed() {
        if (this.condense) {
            this.creatures.forEach((creature, _, arr) => {
                const equiv = arr.filter((c) => equivalent(c, creature));
                equiv.forEach((eq) => {
                    eq.initiative = Math.max(...equiv.map((i) => i.initiative));
                });
            });
        }
        return this.creatures;
    }
    get ordered() {
        const sort = [...this.condensed];
        sort.sort((a, b) => {
            return b.initiative - a.initiative;
        });
        return sort;
    }

    get enabled() {
        return this.ordered.filter((c) => c.enabled);
    }

    addCreatures(creatures: Creature[], trigger = true) {
        /* for (let creature of creatures) {
            this.creatures.push(creature);
        } */

        this.setCreatures([...(this.creatures ?? []), ...(creatures ?? [])]);

        if (trigger)
            this.trigger("initiative-tracker:creatures-added", creatures);

        this.setAppState({
            creatures: this.ordered
        });
    }

    removeCreature(...creatures: Creature[]) {
        if (creatures.some((c) => c.active)) {
            const active = this.creatures.find((c) => c.active);
            this.goToNext();
            this.setCreatures(this.creatures.filter((c) => c != active));
            this.removeCreature(...creatures.filter((c) => c != active));
            return;
        }
        this.setCreatures(this.creatures.filter((c) => !creatures.includes(c)));
        this.trigger("initiative-tracker:creatures-removed", creatures);
        this.setAppState({
            creatures: this.ordered
        });
    }

    setCreatures(creatures: Creature[]) {
        this.creatures = creatures;

        for (let i = 0; i < this.creatures.length; i++) {
            const creature = this.creatures[i];
            if (
                creature.player ||
                this.creatures.filter((c) => c.name == creature.name).length ==
                    1
            ) {
                continue;
            }
            if (creature.number > 0) continue;
            const prior = this.creatures
                .slice(0, i)
                .filter((c) => c.name == creature.name)
                .map((c) => c.number);
            creature.number = prior?.length ? Math.max(...prior) + 1 : 1;
        }
    }

    async newEncounter(
        {
            name,
            party,
            players,
            creatures,
            roll,
            xp
        }: {
            party?: string;
            name?: string;
            players?: string[];
            creatures?: Creature[];
            roll?: boolean;
            xp?: number;
        } = {
            party: this.party?.name,
            players: [...this.plugin.data.players.map((p) => p.name)],
            creatures: [],
            roll: true
        }
    ) {
        this.creatures = [];
        const playerNames: Set<string> = new Set(players ?? []);
        if (party) {
            playerNames.clear();
            this.party = this.plugin.data.parties.find((p) => p.name == party);
            for (const player of this.players) {
                playerNames.add(player.name);
            }
        }
        for (const player of playerNames) {
            if (!this.plugin.playerCreatures.has(player)) continue;
            this.creatures.push(this.plugin.playerCreatures.get(player));
        }

        if (creatures) this.setCreatures([...this.creatures, ...creatures]);

        this.name = name;
        this.round = 1;
        this.setAppState({
            party: this.party?.name,
            name: this.name,
            round: this.round,
            xp
        });

        for (let creature of this.creatures) {
            creature.enabled = true;
        }

        this.trigger("initiative-tracker:new-encounter", this.appState);

        if (roll) await this.rollInitiatives();
        else {
            this.setAppState({
                creatures: this.ordered
            });
        }
    }

    resetEncounter() {
        for (let creature of this.ordered) {
            creature.hp = creature.max;
            this.setCreatureState(creature, true);
            const statuses = Array.from(creature.status);
            statuses.forEach((status) => {
                this.removeStatus(creature, status);
            });
            creature.active = false;
        }

        if (this.ordered.length) this.ordered[0].active = true;

        this.setAppState({
            creatures: this.ordered
        });
    }
    setMapState(v: boolean) {
        this.setAppState({
            map: v
        });
    }
    async getInitiativeValue(modifier: number = 0): Promise<number> {
        return await this.plugin.getInitiativeValue(modifier);
    }

    async rollInitiatives() {
        for (let creature of this.creatures) {
            creature.initiative = await this.getInitiativeValue(
                creature.modifier
            );
            creature.active = false;
        }

        if (this.ordered.length) this.ordered[0].active = true;

        this.setAppState({
            creatures: this.ordered
        });
    }
    get appState() {
        return {
            state: this.state,
            pcs: this.pcs,
            npcs: this.npcs,
            creatures: this.ordered
        };
    }
    goToNext(active = this.ordered.findIndex((c) => c.active)) {
        /* const active = this.ordered.findIndex((c) => c.active); */
        if (active == -1) return;
        const sliced = [
            ...this.ordered.slice(active + 1),
            ...this.ordered.slice(0, active)
        ];
        const next = sliced.find((c) => c.enabled);
        if (this.ordered[active]) this.ordered[active].active = false;
        if (!next) return;
        if (active > this.ordered.indexOf(next)) this.round++;
        next.active = true;

        this.trigger("initiative-tracker:active-change", next);

        this.setAppState({
            creatures: this.ordered,
            round: this.round
        });
    }
    goToPrevious(active = this.ordered.findIndex((c) => c.active)) {
        /* const active = this.ordered.findIndex((c) => c.active); */
        if (active == -1) return;

        const previous = [...this.ordered].slice(0, active).reverse();
        const after = [...this.ordered].slice(active + 1).reverse();
        const creature = [...previous, ...after].find((c) => c.enabled);
        if (!creature) return;
        if (active < this.ordered.indexOf(creature)) {
            if (this.round == 1) {
                return;
            }
            this.round = this.round - 1;
            
        }
        if (this.ordered[active]) this.ordered[active].active = false;
        creature.active = true;
        this.trigger("initiative-tracker:active-change", creature);
        this.setAppState({
            creatures: this.ordered,
            round: this.round
        });
    }
    toggleState() {
        this.state = !this.state;
        this.creatures.forEach((c) => (c.active = false));
        if (this.state) {
            const active = this.ordered.find((c) => c.enabled);
            if (active) {
                active.active = true;
                this.trigger("initiative-tracker:active-change", active);
            }
        } else {
            this.trigger("initiative-tracker:active-change", null);
        }

        this.setAppState({
            state: this.state
        });
    }
    addStatus(creature: Creature, tag: Condition) {
        creature.status.add(tag);

        this.trigger("initiative-tracker:creature-updated", creature);

        this.setAppState({
            creatures: this.ordered
        });
    }
    removeStatus(creature: Creature, tag: Condition) {
        creature.status.delete(tag);

        this.trigger("initiative-tracker:creature-updated", creature);

        this.setAppState({
            creatures: this.ordered
        });
    }
    updateCreature(
        creature: Creature,
        {
            hp,
            max,
            ac,
            initiative,
            name,
            temp,
            marker
        }: {
            hp?: number;
            ac?: number;
            initiative?: number;
            name?: string;
            marker?: string;
            temp?: number;
            max?: number;
        }
    ) {
        if (initiative) {
            creature.initiative = Number(initiative);
        }
        if (name) {
            creature.name = name;
            creature.number = 0;
        }
        if (hp) {
            // Reduce temp HP first
            hp = Number(hp)
            if (hp < 0 && creature.temp > 0) {
                const remaining = creature.temp + hp;
                creature.temp   = Math.max(0, remaining);
                hp              = Math.min(0, remaining);
            }
            // Clamp HP at 0 if clamp is enabled in settings
            if (this.plugin.data.clamp && creature.hp + hp < 0) {
                hp = -creature.hp;
            }
            // Handle overflow healing according to settings
            if (hp > 0 && hp + creature.hp > creature.max) {
                switch (this.plugin.data.hpOverflow) {
                    case OVERFLOW_TYPE.ignore:
                        hp = Math.max((creature.max - creature.hp), 0);
                        break;
                    case OVERFLOW_TYPE.temp:
                        // Gives temp a value, such that it will be set later
                        temp = hp - Math.min((creature.max - creature.hp), 0)
                        hp -= temp;
                        break;
                    case OVERFLOW_TYPE.current:
                        break;
                }
            }
            creature.hp += hp;
            if (this.plugin.data.autoStatus && creature.hp <= 0) {
                this.addStatus(
                    creature,
                    this.plugin.data.statuses.find((s) => s.name == "Unconscious")
                );
            }
        }
        if (max) {
            if (creature.hp == creature.max) {
                creature.hp = Number(max);
            }
            creature.max = Number(max);
        }
        if (ac) {
            creature.ac = ac;
        }
        if (temp) {
            let baseline = 0;
            if (this.plugin.data.additiveTemp) {
                baseline = creature.temp;
            }
            creature.temp = Math.max(creature.temp, baseline + temp);
        }
        if (marker) {
            creature.marker = marker;
        }
        this.trigger("initiative-tracker:creature-updated", creature);

        this.setAppState({
            creatures: this.ordered
        });
    }
    async copyInitiativeOrder() {
        const contents = this.ordered
            .map((creature) => `${creature.initiative} ${creature.name}`)
            .join("\n");
        await navigator.clipboard.writeText(contents);
    }
    setCreatureState(creature: Creature, enabled: boolean) {
        if (enabled) {
            this._enableCreature(creature);
        } else {
            this._disableCreature(creature);
        }

        this.trigger("initiative-tracker:creature-updated", creature);

        this.setAppState({
            creatures: this.ordered
        });
    }
    private _enableCreature(creature: Creature) {
        creature.enabled = true;
        if (this.enabled.length == 1) {
            creature.active = true;
        }
    }
    private _disableCreature(creature: Creature) {
        if (creature.active) {
            this.goToNext();
        }
        creature.enabled = false;
    }

    setAppState(state: Partial<App["$$prop_def"]>) {
        if (this._app && this._rendered) {
            this.plugin.app.workspace.trigger(
                "initiative-tracker:state-change",
                this.appState
            );
            this._app.$set(state);
        }

        this.plugin.data.state = this.toState();
        this.trigger("initiative-tracker:should-save");
    }
    async onOpen() {
        this._app = new App({
            target: this.contentEl,
            props: {
                party: this.party?.name,
                creatures: this.ordered,
                state: this.state,
                xp: null,
                view: this,
                plugin: this.plugin,
                round: this.round
            }
        });
        this._rendered = true;
    }
    async onClose() {
        this._app.$destroy();
        this._rendered = false;
        this.trigger("initiative-tracker:closed");
    }
    getViewType() {
        return INTIATIVE_TRACKER_VIEW;
    }
    getDisplayText() {
        return "Initiative Tracker";
    }
    getIcon() {
        return BASE;
    }
    openInitiativeView() {
        this.plugin.leaflet.openInitiativeView(this.pcs, this.npcs);
    }

    trigger(...args: TrackerEvents) {
        const [name, ...data] = args;
        this.app.workspace.trigger(name, ...data);
    }
    toState() {
        if (!this.state) return null;
        return {
            creatures: [...this.ordered.map((c) => c.toJSON())],
            state: this.state,
            name: this.name,
            round: this.round
        };
    }
    async onunload() {
        this.plugin.data.state = this.toState();
        await this.plugin.saveSettings();
    }
    registerEvents() {
        this.registerEvent(
            this.app.workspace.on(
                "initiative-tracker:add-creature-here",
                async (latlng: L.LatLng) => {
                    this.app.workspace.revealLeaf(this.leaf);
                    let addNewAsync = this._app.$on("add-new-async", (evt) => {
                        const creature = evt.detail;
                        this._addCreature(creature);

                        this.trigger(
                            "initiative-tracker:creature-added-at-location",
                            creature,
                            latlng
                        );
                        addNewAsync();
                        cancel();
                    });
                    let cancel = this._app.$on("cancel-add-new-async", () => {
                        addNewAsync();
                        cancel();
                    });
                    this._app.$set({ addNewAsync: true });
                }
            )
        );
        this.registerEvent(
            this.app.workspace.on(
                "initiative-tracker:creature-updated-in-settings",
                (creature: Creature) => {
                    const existing = this.creatures.find((c) => c == creature);

                    if (existing) {
                        this.updateCreature(existing, creature);
                    }
                }
            )
        );
        this.registerEvent(
            this.app.workspace.on(
                "initiative-tracker:remove",
                (creature: Creature) => {
                    const existing = this.creatures.find(
                        (c) => c.id == creature.id
                    );

                    if (existing) {
                        this.removeCreature(existing);
                    }
                }
            )
        );
        this.registerEvent(
            this.app.workspace.on(
                "initiative-tracker:enable-disable",
                (creature: Creature, enable: boolean) => {
                    const existing = this.creatures.find(
                        (c) => c.id == creature.id
                    );

                    if (existing) {
                        this.setCreatureState(existing, enable);
                    }
                }
            )
        );
        this.registerEvent(
            this.app.workspace.on(
                "initiative-tracker:apply-damage",
                (creature: Creature) => {
                    const existing = this.creatures.find(
                        (c) => c.id == creature.id
                    );

                    if (existing) {
                        this.setAppState({
                            updatingHP: existing
                        });
                    }
                }
            )
        );
        this.registerEvent(
            this.app.workspace.on(
                "initiative-tracker:add-status",
                (creature: Creature) => {
                    const existing = this.creatures.find(
                        (c) => c.id == creature.id
                    );

                    if (existing) {
                        this.setAppState({
                            updatingStatus: existing
                        });
                    }
                }
            )
        );
    }
}

export class CreatureView extends ItemView {
    buttonEl = this.contentEl.createDiv("creature-view-button");
    statblockEl = this.contentEl.createDiv("creature-statblock-container");
    constructor(leaf: WorkspaceLeaf, public plugin: InitiativeTracker) {
        super(leaf);
        this.load();
        this.containerEl.addClass("creature-view-container");
    }
    onload() {
        new ExtraButtonComponent(this.buttonEl)
            .setIcon("cross")
            .setTooltip("Close Statblock")
            .onClick(() => {
                this.render();
                this.app.workspace.trigger("initiative-tracker:stop-viewing");
            });
    }
    onunload(): void {
        this.app.workspace.trigger("initiative-tracker:stop-viewing");
    }
    render(creature?: HomebrewCreature) {
        this.statblockEl.empty();
        if (!creature) {
            this.statblockEl.createEl("em", {
                text: "Select a creature to view it here."
            });
            return;
        }
        if (
            this.plugin.canUseStatBlocks &&
            this.plugin.statblockVersion?.major >= 2
        ) {
            const statblock = this.plugin.statblocks.render(
                creature,
                this.statblockEl,
                creature.display
            );
            if (statblock) {
                this.addChild(statblock);
            }
        } else {
            this.statblockEl.createEl("em", {
                text: "Install the TTRPG Statblocks plugin to use this feature!"
            });
        }
    }
    getDisplayText(): string {
        return "Combatant";
    }
    getIcon(): string {
        return CREATURE;
    }
    getViewType(): string {
        return CREATURE_TRACKER_VIEW;
    }
}
