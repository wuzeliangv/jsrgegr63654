const test = require('node:test');
const assert = require('node:assert/strict');

const { prizeAngle, getSpinRotationDelta } = require('../public/js/lucky-wheel');

test('lucky wheel rotation aligns each prize segment with the top pointer', () => {
  assert.equal(getSpinRotationDelta(0), 67.5);
  assert.equal(getSpinRotationDelta(1), 22.5);
  assert.equal(getSpinRotationDelta(2), 337.5);
  assert.equal(getSpinRotationDelta(3), 292.5);
});

test('old 180 degree offset would point to the opposite segment', () => {
  const index = 0;
  const oldRotationDelta = (360 - prizeAngle(index) + 180) % 360;
  const landedAngle = (prizeAngle(index) + oldRotationDelta) % 360;
  assert.equal(landedAngle, 180);
});

test('sequential spins should still land on the requested segment', () => {
  let currentRotation = 0;
  const requestedIndexes = [0, 4, 1, 7, 2];

  for (const index of requestedIndexes) {
    const targetRotation = getSpinRotationDelta(index);
    const normalizedRotation = ((currentRotation % 360) + 360) % 360;
    const correction = (targetRotation - normalizedRotation + 360) % 360;
    currentRotation += 6 * 360 + correction;
    assert.equal(
      ((currentRotation % 360) + 360) % 360,
      targetRotation,
      `prize index ${index} should keep the intended normalized wheel rotation after repeated spins`
    );
  }
});
