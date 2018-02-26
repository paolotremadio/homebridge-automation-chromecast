# Manual test cases

### It does detect the current state on boot
- Chromecast not streaming, start homebridge -> switch status = off
- Chromecast single device streaming, start homebridge -> switch status = on
- Chromecast group streaming, start homebridge -> switch status = on


### It does keep up with changes in state
- Start homebridge, stream to single device -> switch status = on
- Start homebridge, stop stream to single device -> switch status = off
- Start Chromecast single device streaming, start homebridge, stop the streaming -> switch status = off
- Start homebridge, stream to group -> switch status = on
- Start homebridge, stop stream to group -> switch status = off

### It does handle network issues
- Chromecast not streaming, start homebridge, disconnect chromecast -> should wait and reconnect
- Disconnect the homebridge network -> should fail with ECONNRESET and/or ECONNREFUSED and reconnect


The Chromecast protocol is not well document and the CastV2 library is not up to date. There's no way to automate those tests.
Please re-run all those tests before releasing.
