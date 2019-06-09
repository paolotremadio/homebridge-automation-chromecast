
# Controller - Chromecast / Chromecast Audio  
  
Example config.json:  
  
```json
"platforms":[
    {
      "platform" : "ControlChromecast",
      "name" : "Chromecast"
    }
]
```
  
This accessory will create a lightbulb linked with the status of a Chromecast or Chromecast Audio device.  
  
Turning On the the bulb will play the currently casted stream. Turning Off the switch will pause the stream.  

The switch has the following properties:
  
## Configuration options  
  
| Attribute | Required | Usage | Example |
|-----------|----------|-------|---------|
| ignoredDevices | no | The name of your Chromecast device as shown in your Google Home App (case insensitive). This will ignore the device and controller will not be added. | `Living Room` |

## Credits
This project as been largely inspired by the work of [@robertherber](https://bitbucket.org/robertherber/homebridge-chromecast/src) and [@paolotremadio](https://github.com/paolotremadio/homebridge-automation-chromecast)
