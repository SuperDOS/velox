// Smart Hub Preview: the row of tiles above the app in the TV's home bar.
// The app hands the tiles over in an app control ("preview" = JSON) and this
// background service passes them to Samsung's Preview API, then replies with
// how that went. The system also starts it on its own (when the app is focused
// in the home bar); then there's nothing new and the last tiles stay.
// Tizen 6.0 provides webapis as a global in services; older guides load it
// with require('$WEBAPIS/webapis/webapis.js').
var webapis = global.webapis || null;
var loadError = '';
if (!webapis) {
  try {
    webapis = require('$WEBAPIS/webapis/webapis.js');
  } catch (e) {
    loadError = 'webapis: ' + e.message;
  }
}

function finish(req, status) {
  try {
    if (req) req.replyResult([new tizen.ApplicationControlData('status', [status])]);
  } catch (e) {}
  setTimeout(function () {
    try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
  }, 500);
}

module.exports.onStart = function () {};

module.exports.onRequest = function () {
  var req = null;
  var json = null;
  try {
    req = tizen.application.getCurrentApplication().getRequestedAppControl();
    (req && req.appControl.data || []).forEach(function (d) {
      if (d.key === 'preview') json = d.value[0];
    });
  } catch (e) {}
  if (!json) { finish(req, 'nothing to publish'); return; }
  if (!webapis || !webapis.preview) { finish(req, 'no preview API ' + loadError); return; }
  try {
    webapis.preview.setPreviewData(json,
      function () { finish(req, 'ok'); },
      function (e) { finish(req, 'failed ' + (e && (e.name + ' ' + e.message))); });
  } catch (e) {
    finish(req, 'exception ' + e.message);
  }
};

module.exports.onExit = function () {};
