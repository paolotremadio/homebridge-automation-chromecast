
# Automation - Chromecast / Chromecast Audio  
  
Example config.json:  
  
```json
{
  "accessories": [
    {
      "accessory": "AutomationChromecast",
      "name": "Test",
      "chromecastDeviceName": "<The device Name of your Chromecast>",
      "switchOffDelay": 10000
    }
  ]
}
```
  
This accessory will create a switch linked with the status of a Chromecast or Chromecast Audio device.  
It will also create a Motion Sensor, to trigger automation.  
  
When you stream some audio/video to the Chromecast / Chromecast Audio, the switch turns on and the Sensor detects movement. Stop the streaming will turn the switch off and the sensor will stop detecting movements.  
  
Turning On the switch will play the currently casted stream. Turning Off the switch will stop the stream.  

The switch has the following properties:

| Name | Description | Example |
|------|-------------|---------|
| Type | The type of the device. | `Chromecast Audio` |
| IP Address | The full IP address + port of the device | `192.168.1.100:8009` |
| ID | The Chromecast UUID | `a80722d5aa123456e408635c475988ca` |
| Volume | The volume slider, to adjust the volume of the device (it can be also used within automations) | n/a | 

Note: some properties are not compatible with iOS Home app, use [Elgato Eve app](https://itunes.apple.com/us/app/elgato-eve/id917695792?mt=8) instead.
  
## Configuration options  
  
| Attribute | Required | Usage | Example |
|-----------|----------|-------|---------|
| name | Yes | A unique name for the accessory. It will be used as the accessory name in HomeKit. | `Living Room TV` |
| chromecastDeviceName | Yes | The name of your Chromecast device as shown in your Google Home App (case insensitive). This plugin will use Bonjour/mdns to detect the IP address of the Chromecast based on this name. | `Living Room` |
| switchOffDelay | No (default: `0`) | The number of milliseconds to wait before the motion sensor stops detecting movement after stop casting. By default it is set to zero: as soon as you stop playing, the motion sensor will switch off. If you want to add a delay, set it to a value greater than zero. This config is useful for automations (see later example on this readme). | `5000` (milliseconds, equal to 5 seconds) |

## Credits
This project as been largely inspired by the work of [@robertherber](https://bitbucket.org/robertherber/homebridge-chromecast/src)  


# Examples
## Dim the lights when I stream some video to my Chromecast  
1. Create an accessory in Homebridge (code example at the top of this readme)  
2. Create a new automation in iOS Home/HomeKit: when the Motion Sensor detects movement, trigger a scene of your choice (e.g. "Movie lights")  
3. Start streaming to the Chromecast. The Motion Sensor will detect a movement, triggering the scene  


## Turn on/off the speakers when I streaming music
Let's assume you have some powered speakers that need to be turned on before use (I have for example the [Yamaha HS8](https://usa.yamaha.com/products/proaudio/speakers/hs_series/index.html)). 

You can connect the speakers to a Chromecast Audio device and connect the to an [Elgato Eve Energy](https://www.elgato.com/en/eve/eve-energy)) switch.

You want to turn On the speakers automatically when streaming music and turning them Off once done.

Here's how:
1. Create an accessory in Homebridge (code example at the top of this readme). Set the `switchOffDelay` to **30000** (30 seconds)  
2. Create a new automation in iOS Home/HomeKit: when the Motion Sensor exposed by this plugin detects movement, turn on the speaker plug
3. Create a new automation in iOS Home/HomeKit: when the Motion Sensor exposed by this plugin stop detecting movement, turn off the speaker plug
4. Start streaming music to the Chromecast. The Motion Sensor will detect a movement, turning on the speakers  
5. Stop / pause streaming. The motion sensor will wait 30 seconds before stop detecting movement, turning off the speakers  
  
Using a delay will prevent the speakers from switching on and off constantly when you momentarily stop/start a stream (to avoid damages to the speakers)

# Other useful plugins
Do you want to play some audio/video on demand from your automation? 

Check my [homebridge-automation-chromecast-play](https://github.com/paolotremadio/homebridge-automation-chromecast-play) plugin.