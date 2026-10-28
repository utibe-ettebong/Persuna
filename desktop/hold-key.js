// Hold-to-talk from one key, with no other keys involved. Pure: main.js feeds
// it key presses from the system-wide listener, and it says what they mean.
//
// - Hold the key on its own for a moment: "start"; let go: "end".
// - Press another key while holding it (a shortcut like ⌥E): nothing, or
//   "cancel" if listening had already started.
// - Tap it twice quickly: "type" (open the message box).

/** How long the key is held, alone, before listening starts. */
const HOLD_MS = 180;
/** Two taps this close together open the message box. */
const DOUBLE_TAP_MS = 380;
/** A press shorter than this is a tap. */
const TAP_MS = 250;

function createHoldKey({ emit, schedule = setTimeout, cancelTimer = clearTimeout }) {
  let key = null;
  let isDown = false;
  let downAt = 0;
  let combo = false;
  let started = false;
  let timer = null;
  let lastTap = -Infinity;

  const clear = () => {
    if (timer !== null) cancelTimer(timer);
    timer = null;
  };

  return {
    /** Which key code holds to talk; null turns it off. */
    setKey(code) {
      key = code;
      clear();
      isDown = false;
      started = false;
    },
    keydown(code, now) {
      if (key === null) return;
      if (code !== key) {
        // Another key while ours is down: a shortcut, not talking.
        if (isDown) {
          combo = true;
          clear();
          if (started) {
            started = false;
            emit("cancel");
          }
        }
        lastTap = -Infinity;
        return;
      }
      if (isDown) return; // key repeat
      isDown = true;
      downAt = now;
      combo = false;
      started = false;
      timer = schedule(() => {
        timer = null;
        if (isDown && !combo) {
          started = true;
          emit("start");
        }
      }, HOLD_MS);
    },
    keyup(code, now) {
      if (key === null || code !== key || !isDown) return;
      const held = now - downAt;
      isDown = false;
      clear();
      if (started) {
        started = false;
        lastTap = -Infinity;
        emit("end");
        return;
      }
      if (combo || held > TAP_MS) return;
      if (now - lastTap <= DOUBLE_TAP_MS) {
        lastTap = -Infinity;
        emit("type");
      } else lastTap = now;
    },
  };
}

module.exports = { createHoldKey, HOLD_MS, DOUBLE_TAP_MS };
