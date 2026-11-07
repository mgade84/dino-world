// Just enough browser globals to import the game modules in Node. Must be imported first.
const g = globalThis as Record<string, unknown>;
g.document ??= { documentElement: {} };
g.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
