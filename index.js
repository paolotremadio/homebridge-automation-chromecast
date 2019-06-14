const mdns = require('mdns');
const CastClient = require('castv2-client').Client;
const CastDefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const pkginfo = require('./package');
const CustomCharacteristics = require('./custom-characteristics');

let Service, Characteristic, PlatformAccessory, UUIDGen;

const mdnsSequence = [
  mdns.rst.DNSServiceResolve(),
  'DNSServiceGetAddrInfo' in mdns.dns_sd ? mdns.rst.DNSServiceGetAddrInfo() : mdns.rst.getaddrinfo({ families: [0] }),
  mdns.rst.makeAddressesUnique(),
];

const getCircularReplacer = () => {
  const seen = new WeakSet();
  return (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }
    return value;
  };
};

/***
 * Platform class - contains all methods for scanning and managing chromecast devices.
 * @param {function} log homebrodge log function
 * @param {object} config homebrodge configuration for the platform defined on config.json
 * @param {object} api homebridge api methods
 */

function ControlChromecastPlatform(log, config, api) {

  if(config){
    this.config = config;

    if (this.config && this.config.ignoredDevices && this.config.ignoredDevices.constructor !== Array)
        delete this.config.ignoredDevices;

    this.CastScanner = mdns.createBrowser(mdns.tcp('googlecast'), { resolverSequence: mdnsSequence });

    if(this.config)
      this.ignoredDevices = this.config.ignoredDevices || [];

    /** homebridge api methods **/
    this.api = api; 
    /** platform accessories **/
    this.accessories = {};
    this.log = log;

    this.api.on('didFinishLaunching', function() {
      this.scanAccesories()
    }.bind(this));
  }
}

ControlChromecastPlatform.prototype.scanAccesories = function () {

  let addChromecast = function(device){
    if(device && device.txtRecord && ['Chromecast', 'Chromecast Audio'].indexOf(device.txtRecord.md) !== -1){
      let uuid = UUIDGen.generate(device.txtRecord.id);
      let accessory = this.accessories[uuid];

      if (this.ignoredDevices && this.ignoredDevices.indexOf(device.txtRecord.fn) !== -1) {
        this.log('Ignoring: %s [%s]', device.txtRecord.fn, device.txtRecord.id)
        if (accessory !== undefined)  
          this.removeAccessory(accessory);
      
        return;
      } else if (accessory === undefined) {
        this.log('Adding a new found Chomecast: %s [%s]', device.txtRecord.fn, device.txtRecord.id)
        this.addAccessory(device);
      } else {
        this.log("Discovered: %s [%s]", device.txtRecord.fn, device.txtRecord.id);
        if(typeof this.accessories[uuid].updateInfo === "function"){

          this.accessories[uuid].updateInfo(device);
          this.accessories[uuid].clientConnect();

        } else this.accessories[uuid] = new ChromecastAccessory(this.log, accessory, device);
      }
    }
  }.bind(this);

  this.CastScanner.on('serviceUp', addChromecast);

  this.CastScanner.on('serviceDown', function(device) {
    // this.log('/*** DEVICE DOWN ****/')
    // this.log(JSON.stringify(device, getCircularReplacer()))
  }.bind(this));

  this.CastScanner.on('serviceChanged', function(device) {
    // this.log('/*** DEVICE CHANGE ****/')
    // this.log(JSON.stringify(device, getCircularReplacer()))
  }.bind(this));

  this.CastScanner.on('error', function(err, device) {
    // this.log('/*** DEVICE ERROR ****/')
    // console.log(JSON.stringify(device, getCircularReplacer()))
    // console.log(JSON.stringify(err, getCircularReplacer()))
    // if(JSON.stringify(err, getCircularReplacer()) === "{}") addChromecast(device);
  }.bind(this));

  // Restart browser every 30 minutes or so to make sure we are listening to announcements
  setTimeout(() => {
    this.CastScanner.stop();
    this.log('scanAccesories() - Restarting Chromecast Scanner');
    
    this.CastScanner = mdns.createBrowser(mdns.tcp('googlecast'), { resolverSequence: mdnsSequence });
    this.scanAccesories();
  }, 30 * 60 * 1000);

  this.log(`Searching for Chromecast devices`);
  this.CastScanner.start();
};

ControlChromecastPlatform.prototype.addAccessory = function (device) {
    this.log('Found Chromecast: "%s" "%s" at %s:%d', device.name, device.txtRecord.fn, device.addresses[0], device.port);

    let accessory = new PlatformAccessory(device.name, UUIDGen.generate(device.txtRecord.id));

    accessory.context.id = device.txtRecord.id;
    accessory.context.name = device.txtRecord.fn;
    accessory.context.make = "Google";
    accessory.context.model = device.txtRecord.md || "Unknown";
    accessory.context.features = { color: false, infrared: false, multizone: false };

    accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, accessory.context.make)
        .setCharacteristic(Characteristic.Model, accessory.context.model)
        .setCharacteristic(Characteristic.SerialNumber, device.txtRecord.id);

    accessory.addService(Service.Lightbulb, accessory.context.name);

    this.accessories[accessory.UUID] = new ChromecastAccessory(this.log, accessory, device);

    this.api.registerPlatformAccessories('homebridge-control-chromecast', 'ControlChromecast', [accessory]);
};

ControlChromecastPlatform.prototype.removeAccessory = function (accessory) {
  this.log('Remove: %s', accessory.context.name);

  if (this.accessories[accessory.UUID]) {
    delete this.accessories[accessory.UUID];
  }

  this.api.unregisterPlatformAccessories('homebridge-control-chromecast', 'ControlChromecast', [accessory]);
};

ControlChromecastPlatform.prototype.configureAccessory = function (accessory) {
  this.accessories[accessory.UUID] = accessory;
};

ControlChromecastPlatform.prototype.configurationRequestHandler = function (context, request, callback) {  // eslint-disable-line
  let respDict = {};

  if (request && request.type === 'Terminate') {
    context.onScreen = null;
  }

  let sortAccessories = function () {
    context.sortedAccessories = Object.keys(this.accessories).map(
      function (k){return this[k] instanceof PlatformAccessory ? this[k] : this[k].accessory;},
      this.accessories
    ).sort(function (a,b) {if (a.context.name < b.context.name) return -1; if (a.context.name > b.context.name) return 1; return 0;});

    return Object.keys(context.sortedAccessories).map(function (k) {return this[k].context.name;}, context.sortedAccessories);
  }.bind(this);

  switch (context.onScreen) {
    case 'DoRemove':
      if (request.response.selections) {
        for (var i in request.response.selections.sort()) {
          this.removeAccessory(context.sortedAccessories[request.response.selections[i]]);
        }

        respDict = {
          'type': 'Interface',
          'interface': 'instruction',
          'title': 'Finished',
          'detail': 'Accessory removal was successful.'
        };

        context.onScreen = null;
        callback(respDict);
      }
      else {
        context.onScreen = null;
        callback(respDict, 'platform', true, this.config);
      }
      break;
    case 'DoModify':
      context.accessory = context.sortedAccessories[request.response.selections[0]];
      context.canAddCharacteristic = [];
      context.canRemoveCharacteristic = [];
      context.canAddService = [];
      context.canRemoveService = [];
      context.onScreenSelection = [];

      var service = context.accessory.getService(Service.Lightbulb);
      var characteristics, services;

      if (!/(650|Original)/.test(context.accessory.context.model)) {
        services = [Service.LightSensor];
      }

      if (context.accessory.context.features.color === true) {
        characteristics = [Characteristic.Brightness, ColorTemperature, Characteristic.Hue, Characteristic.Saturation];
      }
      else {
        characteristics = [Characteristic.Brightness, ColorTemperature];
      }

      for (var index in characteristics) {
        var characteristic = characteristics[index];

        if (service.testCharacteristic(characteristic)) {
          context.canRemoveCharacteristic.push(characteristic);
        }
        else {
          context.canAddCharacteristic.push(characteristic);
        }
      }

      for (var index in services) {
        if (context.accessory.getService(services[index]) !== undefined) {
          context.canRemoveService.push(services[index]);
        }
        else {
          context.canAddService.push(services[index]);
        }
      }

      var items = [];

      if (context.canAddCharacteristic.length > 0) {
        items.push('Add Characteristic');
        context.onScreenSelection.push({action: 'add', item: 'characteristic', screen: 'AddCharacteristic'});
      }

      if (context.canAddService.length > 0) {
        items.push('Add Service');
        context.onScreenSelection.push({action: 'add', item: 'service', screen: 'AddService'});
      }

      if (context.canRemoveCharacteristic.length > 0) {
        items.push('Remove Characteristic');
        context.onScreenSelection.push({action: 'remove', item: 'characteristic', screen: 'RemoveCharacteristic'});
      }

      if (context.canRemoveService.length > 0) {
        items.push('Remove Service');
        context.onScreenSelection.push({action: 'remove', item: 'service', screen: 'RemoveService'});
      }

      respDict = {
        'type': 'Interface',
        'interface': 'list',
        'title': `Select action for ${context.accessory.context.name}`,
        'allowMultipleSelection': false,
        'items': items
      };

      context.onScreen = 'ModifyAccessory';

      callback(respDict);
      break;
    case 'ModifyAccessory':
      var selection = context.onScreenSelection[request.response.selections[0]];

      context.onScreen = selection.screen;

      var items = [];

      for (var index in context[`can${context.onScreen}`]) {
        if (selection.item === 'service') {
          var name;

          switch (context[`can${context.onScreen}`][index].UUID) {
            case Service.LightSensor.UUID:
              name = 'LightSensor';
              break;
          }

          items.push(name);
          continue;
        }

        var characteristic = new (Function.prototype.bind.apply(context[`can${context.onScreen}`][index], arguments));
        items.push(characteristic.displayName);
      }

      respDict = {
        'type': 'Interface',
        'interface': 'list',
        'title': `Select ${selection.item} to ${selection.action}`,
        'allowMultipleSelection': true,
        'items': items
      };

      callback(respDict);
      break;
    case 'AddCharacteristic':
    case 'AddService':
    case 'RemoveCharacteristic':
    case 'RemoveService':
      if (request.response.selections) {
        var service = context.accessory.getService(Service.Lightbulb);

        for (var i in request.response.selections.sort()) {
          let item = context[`can${context.onScreen}`][request.response.selections[i]];

          switch (context.onScreen) {
            case 'AddCharacteristic':
              var characteristic = service.getCharacteristic(item);

              if (characteristic == null) {
                service.addCharacteristic(item);
              }

              if (this.accessories[context.accessory.UUID] instanceof ChromecastAccessory) {
                this.accessories[context.accessory.UUID].addEventHandler(service, item);
              }

              break;
            case 'AddService':
              if (context.accessory.getService(item) === undefined) {
                context.accessory.addService(item, context.accessory.context.name);
              }

              break;
            case 'RemoveCharacteristic':
              var characteristic = service.getCharacteristic(item);

              characteristic.removeAllListeners();
              service.removeCharacteristic(characteristic);

              break;
            case 'RemoveService':
              if (context.accessory.getService(item) !== undefined) {
                context.accessory.removeService(context.accessory.getService(item));
              }
          }
        }

        respDict = {
          'type': 'Interface',
          'interface': 'instruction',
          'title': 'Finished',
          'detail': `Accessory ${/Service$/.test(context.onScreen) ? 'service' : 'characteristic'} ${/^Remove/.test(context.onScreen) ? 'removal' : 'addition'} was successful.`
        };

        context.onScreen = null;
        callback(respDict);
      }
      else {
        context.onScreen = null;
        callback(respDict, 'platform', true, this.config);
      }
      break;
    case 'Menu':
      switch (request.response.selections[0]) {
        case 0:
          context.onScreen = 'Modify';
          break;
        case 1:
          context.onScreen = 'Remove';
          break;
        case 2:
          context.onScreen = 'Configuration';
          break;
      }
    case 'Modify':
    case 'Remove':
      if (context.onScreen != 'Configuration') {
        respDict = {
          'type': 'Interface',
          'interface': 'list',
          'title': `Select accessory to ${context.onScreen.toLowerCase()}`,
          'allowMultipleSelection': context.onScreen == 'Remove',
          'items': sortAccessories()
        };

        context.onScreen = `Do${context.onScreen}`;
      }
      else {
        respDict = {
          'type': 'Interface',
          'interface': 'list',
          'title': 'Select Option',
          'allowMultipleSelection': false,
          'items': ['Ignored Devices']
        };
      }

      callback(respDict);
      break;
    case 'Configuration':
      respDict = {
        'type': 'Interface',
        'interface': 'list',
        'title': 'Modify Ignored Devices',
        'allowMultipleSelection': false,
        'items': (this.ignoredDevices && this.ignoredDevices.length > 0) ? ['Add Accessory', 'Remove Accessory'] : ['Add Accessory']
      };

      context.onScreen = 'IgnoreList';

      callback(respDict);
      break;
    case 'IgnoreList':
      context.onScreen = request && request.response && request.response.selections[0] == 1 ? 'IgnoreListRemove' : 'IgnoreListAdd';

      if (context.onScreen == 'IgnoreListAdd') {
        respDict = {
          'type': 'Interface',
          'interface': 'list',
          'title': 'Select accessory to add to Ignored Devices',
          'allowMultipleSelection': true,
          'items': sortAccessories()
        };
      }
      else {
        context.selection = JSON.parse(JSON.stringify(this.ignoredDevices));

        respDict = {
          'type': 'Interface',
          'interface': 'list',
          'title': 'Select accessory to remove from Ignored Devices',
          'allowMultipleSelection': true,
          'items': context.selection
        };
      }

      callback(respDict);
      break;
    case 'IgnoreListAdd':
      if (request.response.selections) {
        for (var i in request.response.selections.sort()) {
          let accessory = context.sortedAccessories[request.response.selections[i]];

          if (accessory.context && accessory.context.id && this.ignoredDevices && this.ignoredDevices.indexOf(accessory.context.id) == -1) {
            this.ignoredDevices.push(accessory.context.id);
          }

          this.removeAccessory(accessory);
        }

        this.config.ignoredDevices = this.ignoredDevices;

        respDict = {
          'type': 'Interface',
          'interface': 'instruction',
          'title': 'Finished',
          'detail': 'Ignore List update was successful.'
        };
      }

      context.onScreen = null;
      callback(respDict, 'platform', true, this.config);
      break;

    case 'IgnoreListRemove':
      if (request.response.selections) {
        for (var i in request.response.selections) {
          let id = context.selection[request.response.selections[i]];

          if (this.ignoredDevices.indexOf(id) != -1) {
            this.ignoredDevices.splice(this.ignoredDevices.indexOf(id), 1);
          }
        }
      }

      this.config.ignoredDevices = this.ignoredDevices;

      if (this.config && this.config.ignoredDevices.length === 0) {
        delete this.config.ignoredDevices;
      }

      context.onScreen = null;
      callback(respDict, 'platform', true, this.config);
      break;
    default:
      if (request && (request.response || request.type === 'Terminate')) {
        context.onScreen = null;
        callback(respDict, 'platform', true, this.config);
      }
      else {
        respDict = {
          'type': 'Interface',
          'interface': 'list',
          'title': 'Select option',
          'allowMultipleSelection': false,
          'items': ['Modify Accessory', 'Remove Accessory', 'Configuration']
        };

        context.onScreen = 'Menu';
        callback(respDict);
      }
  }
};

/***
 * Accessory class - contains all methods for controlling a chromecast device.
 * @param {function} log homebrodge log function
 * @param {object} accessory homebrodge platform accessory object
 * @param {object} device the scanned device
 */

function ChromecastAccessory(log, accessory, device) {

  this.log = log;
  this.accessory = accessory;

  this.setDefaultProperties(true);

  this.updateInfo(device);

  this.log(`Controlling chromecast on ${this.chromecastIp}:${this.chromecastPort}`);

  this.clientConnect();

  this.power = 0;
  this.volume = 0;

  this.log = log;
  this.callbackStack = [];

  if (!this.accessory instanceof PlatformAccessory) {
    this.log('ERROR \n', this);
    return;
  }

  this.lastCalled = null;

  if (this.accessory.context.id === undefined) {
    this.accessory.context.id = device.txtRecord.id;
  }

  if (this.accessory.context.name === undefined) {
    this.accessory.context.name = this.accessory.displayName;
  }

  let service = this.accessory.getService(Service.Lightbulb);

  if (service.testCharacteristic(Characteristic.Name) === false) {
    service.addCharacteristic(Characteristic.Name);
  }

  if (service.getCharacteristic(Characteristic.Name).value === undefined) {
    service.getCharacteristic(Characteristic.Name).setValue(this.accessory.context.name);
  }

  if (service.testCharacteristic(Characteristic.Brightness) === false) {
    service.addCharacteristic(Characteristic.Brightness)
  }

  this.addEventHandlers();
  this.updateReachability(device);
}

ChromecastAccessory.prototype.clientConnect = function () {
  this.chromecastClient = new CastClient();

  const connectionDetails = {
    host: this.chromecastIp,
    port: this.chromecastPort,
  };

  this.chromecastClient
    .on('status', this.processClientStatus.bind(this))
    .on('timeout', () => this.log('chromeCastClient - timeout'))
    .on('error', status => this.clientError(status));

  this.log(`Connecting to Chromecast on ${this.chromecastIp}:${this.chromecastPort}`);

  this.chromecastClient.connect(connectionDetails, () => {
    if (
      this.chromecastClient &&
      this.chromecastClient.connection &&
      this.chromecastClient.heartbeat &&
      this.chromecastClient.receiver
    ) {
      this.reconnectCounter = 0;
      this.log('Chromecast connection: connected');

      this.chromecastClient.connection
        .on('timeout', () => this.log('chromeCastClient.connection - timeout'))
        .on('disconnect', () => this.clientDisconnect(true));

      this.chromecastClient.heartbeat
        .on('timeout', () => this.log('chromeCastClient.heartbeat - timeout'))
        .on('pong', () => null);

      this.chromecastClient.receiver
        .on('status', this.processClientStatus.bind(this));

      // Force to detect the current status in order to initialise processClientStatus() at boot
      this.chromecastClient.getStatus((err, status) => this.processClientStatus(status));
    }
  });
}

ChromecastAccessory.prototype.resetClient = function () {
  if (this.chromecastClient) {
    try {
      this.chromecastClient.close();
    } catch (e) { // eslint-disable-line
    }
  } else {
    this.chromecastClient = null;
  }
}

ChromecastAccessory.prototype.clientDisconnect = function (reconnect) {
  this.log('Chromecast connection: disconnected');

  this.setIsCasting(false);
  this.setDefaultProperties(false, true);

  if (reconnect) {
    if (this.reconnectCounter > 150) { // Backoff after 5 minutes
      this.log('Chromecast reconnection: backoff, searching again for Chromecast');
      return;
    }

    this.log('Waiting 2 seconds before reconnecting');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectCounter = this.reconnectCounter + 1;
      this.clientConnect();
    }, 2000);
  }
}

ChromecastAccessory.prototype.clientError = function (error) {
  this.log(`Chromecast client - ${error}`);
  let error_string = String(error);

  if(error_string.includes("EHOSTUNREACH") || error_string.includes("ETIMEDOUT")) 
    this.clientDisconnect();
  else this.clientDisconnect(true);
}

ChromecastAccessory.prototype.processClientStatus = function (status) {
  // console.log('processClientStatus() - Received client status', status);

  const { applications } = status;
  const currentApplication = applications && applications.length > 0 ? applications[0] : null;

  if (currentApplication) {
    const lastMonitoredApplicationStatusId =
      this.castingApplication ? this.castingApplication.sessionId : null;

    if (currentApplication.sessionId !== lastMonitoredApplicationStatusId) {
      this.castingApplication = currentApplication;

      /*
      NOTE: The castv2-client library has not been updated in a while.
      The current version of Chromecast protocol may NOT include transportId when streaming
      to a group of speakers. The transportId is same as the sessionId.
      Assigning the transportId to the sessionId makes the library works with
      group of speakers in Chromecast Audio.
       */
      this.castingApplication.transportId = this.castingApplication.sessionId;

      try {
        this.chromecastClient.join(
          this.castingApplication,
          CastDefaultMediaReceiver,
          (_, media) => {
            this.log('processClientStatus() - New media');
            // Force to detect the current status in order to initialise at boot
            media.getStatus((err, mediaStatus) => this.processMediaStatus(mediaStatus));
            media.on('status', this.processMediaStatus.bind(this));
            this.castingMedia = media;
          },
        );
      } catch (e) {
        // Handle exceptions like "Cannot read property 'createChannel' of null"
        this.log('processClientStatus() - Exception', e);
        this.clientDisconnect(true);
      }
    }
  } else {
    this.castingMedia = null;
    this.log('processClientStatus() - Reset media');
  }

  // Process "Stop casting" command
  if (typeof status.applications === 'undefined') {
    this.log('processClientStatus() - Stopped casting');
    this.setIsCasting(false);
  }

  // Process volume
  if (status.volume && 'level' in status.volume) {
    this.volume = status.volume.level;
  }
}

ChromecastAccessory.prototype.processMediaStatus = function (status) {
  // console.log('processMediaStatus() - Received media status', status);

  if (status && status.playerState) {
    if (status.playerState === 'PLAYING' || status.playerState === 'BUFFERING') {
      this.setIsCasting(true);
    } else {
      this.setIsCasting(false);
    }
  }
}

ChromecastAccessory.prototype.setIsCasting = function (statusBool) {
  // Update the internal state and log only if there's been a change of state
  if (statusBool !== this.isCastingStatus) {
    if (statusBool) {
      this.log('Chromecast is now playing');
      this.isCastingStatus = true;
    } else {
      this.log('Chromecast is now stopped');
      this.isCastingStatus = false;
    }
  }
}

/**
 * Is the Chromecast currently receiving an audio/video stream?
 *
 * @param {function} callback
 */
ChromecastAccessory.prototype.isCasting = function  (callback) {
  callback(null, this.isCastingStatus);
}

/**
 * Start/stop the Chromecast from receiving an audio/video stream
 *
 * @param {boolean} on
 * @param {function} callback
 */
ChromecastAccessory.prototype.setCasting = function (on, callback) {
  const currentlyCasting = this.isCastingStatus;
  this.setIsCasting(on);

  this.log(`Current status: ${currentlyCasting} - New status: ${on}`);

  if (!this.castingMedia) {
    callback();
    return;
  }

  if (on && !currentlyCasting) {
    this.log('setCasting() - Play');
    try {
      this.castingMedia.play(() => null);
    } catch(err) {
      // console.log(err)
    }
  } else if (!on && currentlyCasting) {
    this.log('setCasting() - Pause');
    try {
      this.castingMedia.pause(() => null);
    } catch(err) {
      // console.log(err)
    }
  }
  callback();
}


/**
 * Set the Chromecast volume
 *
 * @param {int} volume
 * @param {function} callback
 */
ChromecastAccessory.prototype.setVolume = function (volume, callback) {
  const currentValue = this.volume;

  this.log(`setVolume() - Current status: ${currentValue} - New status: ${volume}`);

  if (this.chromecastClient) {
    try {
      this.chromecastClient.setVolume({ level: volume / 100 }, () => callback());
    } catch(e) {
      // console.log(`setVolume() - Reported error`, e);
      callback();
    }
  }
}

ChromecastAccessory.prototype.getPower = function(callback) {
  // console.log('will get power')
  callback()
}

ChromecastAccessory.prototype.setPower = function(state, callback) {
  this.log("%s - Set power: %d", this.accessory.context.name, state);
}


ChromecastAccessory.prototype.updateInfo = function (device) {
  this.log('Updating chromecast info');
  let ip_address = device.addresses[0];
  let { port } = device;

  this.chromecastIp = ip_address;
  this.chromecastPort = port;

  this.deviceType = device.txtRecord.md || '';
  this.deviceIp = `${ip_address}:${port}`;
  this.deviceId = device.txtRecord.id;
};

ChromecastAccessory.prototype.updateReachability = function (device) {
  this.device = device;
  this.updateInfo(device);
};

ChromecastAccessory.prototype.setDefaultProperties = function (resetIpAndPort = false, stopReconnecting = false) {
  if (resetIpAndPort) {
    this.chromecastIp = null;
    this.chromecastPort = null;
  }

  this.resetClient();

  this.isCastingStatus = false;
  this.castingApplication = null;
  this.castingMedia = null;
  this.volume = 0;

  this.deviceType = null;
  this.deviceIp = null;
  this.deviceId = null;

  if (stopReconnecting) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
  }
  this.reconnectTimer = null;

  if (!this.reconnectCounter) {
    this.reconnectCounter = 0;
  }
}

ChromecastAccessory.prototype.addEventHandler = function (service, characteristic) {
  if (!(service instanceof Service)) {
    service = this.accessory.getService(service);
  }

  if (service === undefined) {
    return;
  }

  if (service.testCharacteristic(characteristic) === false) {
    this.log('testCharacteristic failed')
    return;
  }

  switch (characteristic) {
    case Characteristic.On:
      service
        .getCharacteristic(Characteristic.On)
        .on('get', this.isCasting.bind(this))
        .on('set', this.setCasting.bind(this));
      break;
    case Characteristic.Brightness:
      service
        .getCharacteristic(Characteristic.Brightness)
        .on('get', callback => callback(null, Math.floor(this.volume * 100)))
        .on('set', this.setVolume.bind(this));
      break;
    case CustomCharacteristics.DeviceType:
      service
        addCharacteristic(CustomCharacteristics.DeviceType)
        .on('get', callback => callback(null, this.deviceType));
        break;
    case CustomCharacteristics.DeviceIp:
      service
        .addCharacteristic(CustomCharacteristics.DeviceIp)
        .on('get', callback => callback(null, this.deviceIp));
        break;
    case CustomCharacteristics.DeviceId:
      service
        .addCharacteristic(CustomCharacteristics.DeviceId)
        .on('get', callback => callback(null, this.deviceId));
        break;
  }
};

ChromecastAccessory.prototype.addEventHandlers = function () {
  this.addEventHandler(Service.Lightbulb, Characteristic.On);
  this.addEventHandler(Service.Lightbulb,Characteristic.Brightness);

  this.accessoryInformationService = new Service.AccessoryInformation();
  this.accessoryInformationService
    .setCharacteristic(Characteristic.Name, this.name)
    .setCharacteristic(Characteristic.Manufacturer, pkginfo.author.name || pkginfo.author)
    .setCharacteristic(Characteristic.Model, pkginfo.name)
    .setCharacteristic(Characteristic.SerialNumber, 'n/a')
    .setCharacteristic(Characteristic.FirmwareRevision, pkginfo.version)
    .setCharacteristic(Characteristic.HardwareRevision, pkginfo.version);
};

ChromecastAccessory.prototype.closeCallbacks = function (err, value) {
  value = value || 0;

  while (this.callbackStack.length > 0) {
    this.callbackStack.pop()(err, value);
  }
};


module.exports = function (homebridge) {
  PlatformAccessory = homebridge.platformAccessory; 

  Characteristic = homebridge.hap.Characteristic; 
  Service = homebridge.hap.Service; 
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform('homebridge-control-chromecast', 'ControlChromecast', ControlChromecastPlatform, true);
};