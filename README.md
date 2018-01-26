# Automation - Chromecast monitorign

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

This accessory will create a fake switch linked with the status of a Chromecast or Chromecast Audio device. When the switch is On, the Chromecast is receiving an audio/video stream. When the switch is Off, the Chromecast is paused/stopped.

Turning On the switch will play the currently casted stream. Turning Off the switch will stop the stream.

Please note: the `chromecastDeviceName` has to be the name of the device as set in the Google Home app. The plugin will use Bonjour/mdns to detect the IP address of the device.

This project as been largerly inspired by the work of [@robertherber](https://bitbucket.org/robertherber/homebridge-chromecast/src)

# Example: Dim the lights when I stream some video to my Chromecast
1. Create accessory
2. Use the switch as a trigger for an automation, set a scene of your choice
3. Start streaming to the Chromecast. The switch will turn On, triggering the scene