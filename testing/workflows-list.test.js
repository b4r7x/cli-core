import assert from "node:assert/strict";
import test from "node:test";

import { runListWorkflow } from "../dist/workflows/list.js";
import { setSilent } from "../dist/logger.js";

function makeItems() {
  return [
    { name: "button", title: "Button", description: "A button", deps: ["clsx"], files: ["button.tsx"] },
    { name: "card", title: "Card", description: "A card", deps: [], files: ["card.tsx"] },
  ];
}

function toDisplayItem(item) {
  return { name: item.name, title: item.title, description: item.description, dependencies: item.deps, files: item.files };
}

test("runListWorkflow", async (t) => {
  await t.test("outputs JSON when json=true", () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));

    try {
      runListWorkflow({
        cwd: "/tmp",
        includeAll: false,
        installedOnly: false,
        json: true,
        itemPlural: "components",
        getAllItems: makeItems,
        getPublicItems: makeItems,
        requireConfig: () => ({}),
        isInstalled: () => false,
        toDisplayItem,
      });

      const output = JSON.parse(logs.join(""));
      assert.equal(output.length, 2);
      assert.equal(output[0].name, "button");
    } finally {
      console.log = origLog;
    }
  });

  await t.test("filters to installed only", () => {
    setSilent(true);
    try {
      // This should not throw even with no installed items
      runListWorkflow({
        cwd: "/tmp",
        includeAll: false,
        installedOnly: true,
        json: false,
        itemPlural: "components",
        getAllItems: makeItems,
        getPublicItems: makeItems,
        requireConfig: () => ({}),
        isInstalled: ({ item }) => item.name === "button",
        toDisplayItem,
      });
    } finally {
      setSilent(false);
    }
  });
});
