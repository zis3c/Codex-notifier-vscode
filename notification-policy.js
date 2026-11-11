"use strict";

function shouldSendSystemNotification({ platform, enablePopup, alwaysSystemNotify, toastWhenUnfocused, isFocused }) {
  return enablePopup && (
    (platform === "win32" && alwaysSystemNotify) || (toastWhenUnfocused && !isFocused)
  );
}

module.exports = { shouldSendSystemNotification };
