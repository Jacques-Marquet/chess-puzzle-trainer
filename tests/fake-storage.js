// Stand-ins for window.localStorage, shared by the tests.

export function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    data,
  };
}

/** Storage that throws on every call, like a browser with storage blocked. */
export const brokenStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); },
};
