"use strict";

const assert = require("assert");
const { shouldSendSystemNotification } = require("../notification-policy");

let cases = 0;
for (const platform of ["win32", "darwin", "linux"]) {
  for (const enablePopup of [false, true]) {
    for (const alwaysSystemNotify of [false, true]) {
      for (const toastWhenUnfocused of [false, true]) {
        for (const isFocused of [false, true]) {
          const result = shouldSendSystemNotification({
            platform, enablePopup, alwaysSystemNotify, toastWhenUnfocused, isFocused
          });
          const expected = enablePopup && (platform === "win32" && alwaysSystemNotify
            ? true : toastWhenUnfocused && !isFocused);
          assert.strictEqual(result, expected, JSON.stringify({
            platform, enablePopup, alwaysSystemNotify, toastWhenUnfocused, isFocused
          }));
          cases++;
        }
      }
    }
  }
}
console.log(`Notification policy tests passed (${cases} combinations).`);
