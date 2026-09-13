import assert from "node:assert/strict";
import test from "node:test";
import tokenUsageExtension from "../src/index.js";

test("registers /usage command with 7/30/today/all argument completions", () => {
  let commandName = "";
  let commandDef: any;
  const mockPi: any = {
    registerCommand(name: string, def: any) {
      commandName = name;
      commandDef = def;
    },
  };

  tokenUsageExtension(mockPi);
  assert.equal(commandName, "usage");
  assert.ok(commandDef);

  const completions = commandDef.getArgumentCompletions("");
  assert.deepEqual(completions, [
    { value: "today", label: "today" },
    { value: "7", label: "7" },
    { value: "30", label: "30" },
    { value: "all", label: "all" },
  ]);

  const completions3 = commandDef.getArgumentCompletions("3");
  assert.deepEqual(completions3, [{ value: "30", label: "30" }]);
});
