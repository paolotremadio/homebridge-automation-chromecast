# Automation - Chromecast

Example config.json:

```
    "accessories": [
        {
            "accessory": "AutomationChromecast",
            "name": "Test",
            "chromecastDeviceName": "<The device Name of your Chromecast>"
        }  
    ]

```

This accessory will create a fake switch linked with the status of a Chromecast or Chromecast Audio device.
It will also create a fake Motion Sensor.
When you stream some audio/video to the Chromecast / Chromecast Audio, the switch turns on and the Sensor detects movement. Stop the streaming will turn the switch off and the sensor will stop detecting movements.

Turning On the switch will play the currently casted stream. Turning Off the switch will stop the stream.

Please note: the `chromecastDeviceName` has to be the name of the device as set in the Google Home app. The plugin will use Bonjour/mdns to detect the IP address of the device.

This project as been largely inspired by the work of [@robertherber](https://bitbucket.org/robertherber/homebridge-chromecast/src)

# Example: Dim the lights when I stream some video to my Chromecast
1. Create accessory
2. Use the Motion Sensor as a trigger for an automation, set a scene of your choice upon start streaming (e.g. turn on the speakers)
3. Start streaming to the Chromecast. The Motion Sensor will detect a movement, triggering the scene