import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSourceVectorScale, sourceScaleLabel } from "../src/services/visualization/sourceVectorScale.js";

test("source scale retains logarithmic extremes instead of clipping them to the old range", () => {
  for (const scale of [.0001,.001,.1,1,10,100,10000]) assert.equal(normalizeSourceVectorScale(scale),scale);
  assert.equal(normalizeSourceVectorScale(0),.0001);
  assert.equal(normalizeSourceVectorScale(1e9),10000);
  assert.equal(normalizeSourceVectorScale(NaN),1);
  assert.equal(sourceScaleLabel(.0001),"×0,0001");
  assert.equal(sourceScaleLabel(1),"×1");
  assert.ok(!sourceScaleLabel(.00012).endsWith("×0"));
});
