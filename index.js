const mdns = require('mdns');
const CastClient = require('castv2-client').Client;
const CastDefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const debug = require('debug');

const pkginfo = require('./package');
const CustomCharacteristics = require('./custom-characteristics');

let Service;
let Characteristic;

const mdnsSequence = [
  mdns.rst.DNSServiceResolve(),
  'DNSServiceGetAddrInfo' in mdns.dns_sd ? mdns.rst.DNSServiceGetAddrInfo() : mdns.rst.getaddrinfo({ families: [0] }),
  mdns.rst.makeAddressesUnique(),
];


function ControlChromecastPlatform(log, config, api) {
  if (!config) {
    log.warn("Ignoring LIFX Platform setup because it is not configured");
    this.disabled = true;
    return;
  }

  this.config = config;

  fadeDuration = this.config.duration || 1000;

  if (this.config.ignoredDevices && this.config.ignoredDevices.constructor !== Array) {
      delete this.config.ignoredDevices;
  }

  this.ignoredDevices = this.config.ignoredDevices || [];

  this.api = api;
  this.accessories = {};
  this.log = log;

  Client.on('light-offline', function(bulb) {
      var uuid = UUIDGen.generate(bulb.id);
      var object = this.accessories[uuid];

      if (object !== undefined) {
          if (object instanceof LifxAccessory) {
              this.log("Offline: %s [%s]", object.accessory.context.name, bulb.id);
          }
      }
  }.bind(this));

  Client.on('light-online', function(bulb) {
      var uuid = UUIDGen.generate(bulb.id);
      var accessory = this.accessories[uuid];

      if (this.ignoredDevices.indexOf(bulb.id) !== -1) {
          if (accessory !== undefined) {
              this.removeAccessory(accessory);
          }

          return;
      }
      else if (accessory === undefined) {
          this.addAccessory(bulb);
      }
      else {
          if (accessory instanceof LifxAccessory) {
              this.log("Online: %s [%s]", accessory.accessory.context.name, bulb.id);
              accessory.updateReachability(bulb);
          }
      }
  }.bind(this));

  Client.on('light-new', function(bulb) {
      var uuid = UUIDGen.generate(bulb.id);
      var accessory = this.accessories[uuid];

      if (this.ignoredDevices.indexOf(bulb.id) !== -1) {
          if (accessory !== undefined) {
              this.removeAccessory(accessory);
          }

          return;
      }
      else if (accessory === undefined) {
          this.addAccessory(bulb);
      }
      else {
          bulb.getState(function(err, state) {
              if (err) {
                  state = {
                      label: bulb.client.label
                  }
              }

              this.log("Online: %s [%s]", accessory.context.name, bulb.id);
              this.accessories[uuid] = new LifxAccessory(this.log, accessory, bulb, state);
          }.bind(this));
      }
  }.bind(this));

  this.api.on('didFinishLaunching', function() {
      Client.init({
          debug:                  this.config.debug || false,
          broadcast:              this.config.broadcast || '255.255.255.255',
          lightOfflineTolerance:  this.config.lightOfflineTolerance || 2,
          messageHandlerTimeout:  this.config.messageHandlerTimeout || 2500,
          resendMaxTimes:         this.config.resendMaxTimes || 3,
          resendPacketDelay:      this.config.resendPacketDelay || 500,
          address:                this.config.address || '0.0.0.0'
      });
  }.bind(this));

}

ControlChromecastPlatform.prototype.addAccessory = function (bulb, data) {
  bulb.getState(function (err, state) {
    if (err) {
      state = {
        label: bulb.client.label
      };
    }

    bulb.getHardwareVersion(function (err, data) {
      if (err) {
        data = {};
      }

      let name = `LIFX ${bulb.id.replace(/d073d5/, '')}`;
      let accessory = new PlatformAccessory(name, UUIDGen.generate(bulb.id));

      accessory.context.name = state.label || name;
      accessory.context.make = data.vendorName || 'LIFX';
      accessory.context.model = data.productName || 'Unknown';
      accessory.context.features = data.productFeatures || { color: false, infrared: false, multizone: false };

      accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, accessory.context.make)
        .setCharacteristic(Characteristic.Model, accessory.context.model)
        .setCharacteristic(Characteristic.SerialNumber, bulb.id);

      this.log('Found: %s [%s]', accessory.context.name, bulb.id);

      let service = accessory.addService(Service.Lightbulb, accessory.context.name);

      service.addCharacteristic(Characteristic.Brightness);
      service.addCharacteristic(ColorTemperature);

      if (accessory.context.features.color === true) {
        service.addCharacteristic(Characteristic.Hue);
        service.addCharacteristic(Characteristic.Saturation);
      }

      this.accessories[accessory.UUID] = new LifxAccessory(this.log, accessory, bulb, data);

      this.api.registerPlatformAccessories('homebridge-lifx-lan', 'LifxLan', [accessory]);
    }.bind(this));
  }.bind(this));
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

              if (this.accessories[context.accessory.UUID] instanceof LifxAccessory) {
                this.accessories[context.accessory.UUID].addEventHandler(service, item);
              }

              break;
            case 'AddService':
              if (context.accessory.getService(item) === undefined) {
                context.accessory.addService(item, context.accessory.context.name);

                this.accessories[context.accessory.UUID].addEventHandler(Service.LightSensor, Characteristic.CurrentAmbientLightLevel);
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
        'items': this.ignoredDevices.length > 0 ? ['Add Accessory', 'Remove Accessory'] : ['Add Accessory']
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

          if (accessory.context && accessory.context.id && this.ignoredDevices.indexOf(accessory.context.id) == -1) {
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

      if (this.config.ignoredDevices.length === 0) {
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

ControlChromecastPlatform.prototype.removeAccessory = function (accessory) {
  this.log('Remove: %s', accessory.context.name);

  if (this.accessories[accessory.UUID]) {
    delete this.accessories[accessory.UUID];
  }

  this.api.unregisterPlatformAccessories('homebridge-lifx-lan', 'LifxLan', [accessory]);
};

function ChromecastAccessory(log, accessory, bulb, data) {
  this.accessory = accessory;
  this.power = data.power || 0;
  this.color = data.color || {hue: 0, saturation: 0, brightness: 50, kelvin: 2500};
  this.log = log;
  this.callbackStack = [];

  if (!this.accessory instanceof PlatformAccessory) {
    this.log('ERROR \n', this);
    return;
  }

  this.lastCalled = null;

  if (this.accessory.context.id === undefined) {
    this.accessory.context.id = bulb.id;
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

  if (service.testCharacteristic(Characteristic.CurrentAmbientLightLevel)) {
    service.removeCharacteristic(service.getCharacteristic(Characteristic.CurrentAmbientLightLevel));
  }

  if (service.testCharacteristic(Kelvin)) {
    service.removeCharacteristic(service.getCharacteristic(Kelvin));
    service.addCharacteristic(ColorTemperature);
  }

  this.accessory.on('identify', function (paired, callback) {
    this.log('%s - identify', this.accessory.context.name);
    this.setWaveform(null, callback);
  }.bind(this));

  this.addEventHandlers();
  this.updateReachability(bulb);
}

ChromecastAccessory.prototype.addEventHandler = function (service, characteristic) {
  if (!(service instanceof Service)) {
    service = this.accessory.getService(service);
  }

  if (service === undefined) {
    return;
  }

  if (service.testCharacteristic(characteristic) === false) {
    return;
  }

  switch (characteristic) {
    case Characteristic.On:
      service
        .getCharacteristic(Characteristic.On)
        .setValue(this.power > 0)
        .on('get', this.getPower.bind(this))
        .on('set', this.setPower.bind(this));
      break;
    case Characteristic.Brightness:
      service
        .getCharacteristic(Characteristic.Brightness)
        .setValue(this.color.brightness)
        .setProps({minValue: 1})
        .on('set', this.setBrightness.bind(this));
      break;
  }
};

ChromecastAccessory.prototype.addEventHandlers = function () {
  this.addEventHandler(Service.Lightbulb, Characteristic.On);
  this.addEventHandler(Service.Lightbulb,Characteristic.Brightness);
  this.addEventHandler(Service.LightSensor, Characteristic.CurrentAmbientLightLevel);
  this.addEventHandler(Service.Lightbulb, ColorTemperature);

  this.addEventHandler(Service.Lightbulb, Characteristic.Hue);
  this.addEventHandler(Service.Lightbulb, Characteristic.Saturation);
};

ChromecastAccessory.prototype.closeCallbacks = function (err, value) {
  value = value || 0;

  while (this.callbackStack.length > 0) {
    this.callbackStack.pop()(err, value);
  }
};



ChromecastAccessory.prototype.getState = function (type, callback) {
  if (this.lastCalled && (Date.now() - this.lastCalled) < 5000) {
    callback(null, this.get(type));
    return;
  }

  this.lastCalled = Date.now();

  this.callbackStack.push(callback);

  this.bulb.getState(function (err, data) {
    if (data) {
      this.power = data.power;
      this.color = data.color;

      let service = this.accessory.getService(Service.Lightbulb);

      if (service.testCharacteristic(Characteristic.Brightness)) {
        service.getCharacteristic(Characteristic.Brightness).updateValue(this.color.brightness);
      }

      if (service.testCharacteristic(ColorTemperature)) {
        service.getCharacteristic(ColorTemperature).updateValue(this.miredConversion(this.color.kelvin));
      }

      if (service.testCharacteristic(Characteristic.Hue)) {
        service.getCharacteristic(Characteristic.Hue).updateValue(this.color.hue);
      }

      if (service.testCharacteristic(Characteristic.Saturation)) {
        service.getCharacteristic(Characteristic.Saturation).updateValue(this.color.saturation);
      }
    }

    this.closeCallbacks(null, this.get(type));
  }.bind(this));
};

ChromecastAccessory.prototype.setBrightness = function (value, callback) {
  if (value == this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Brightness).value) {
    callback(null);
    return;
  }

  this.setColor('brightness', value, callback);
};

ChromecastAccessory.prototype.setPower = function (state, callback) {
  this.log('%s - Set power: %d', this.accessory.context.name, state);

  this.bulb[state ? 'on' : 'off'](fadeDuration, function (err) {
    if (!err) {
      this.power = state;
    }

    callback(null);
  }.bind(this));
};

ChromecastAccessory.prototype.updateInfo = function () {
  this.bulb.getFirmwareVersion(function (err, data) {
    if (err) {
      return;
    }

    let service = this.accessory.getService(Service.AccessoryInformation);

    if (service.testCharacteristic(Characteristic.FirmwareRevision) === false) {
      service.addCharacteristic(Characteristic.FirmwareRevision);
    }

    service.setCharacteristic(Characteristic.FirmwareRevision, `${data.majorVersion}.${data.minorVersion}`);
  }.bind(this));

  let model = this.accessory.getService(Service.AccessoryInformation).getCharacteristic(Characteristic.Model).value;

  if (model !== 'Unknown' && model !== 'Default-Model' && this.accessory.context.features !== undefined) {
    let service = this.accessory.getService(Service.Lightbulb);

    if (this.accessory.context.features.color === false && service.testCharacteristic(ColorTemperature) === true) {
      service.getCharacteristic(ColorTemperature).setProps({
        maxValue: 370,
        minValue: 154
      });
    }
    return;
  }

  this.bulb.getHardwareVersion(function (err, data) {
    if (err) {
      data = {};
    }

    this.accessory.context.make = data.vendorName || 'LIFX';
    this.accessory.context.model = data.productName || 'Unknown';
    this.accessory.context.features = data.productFeatures || { color: false, infrared: false, multizone: false };

    this.accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, this.accessory.context.make)
      .setCharacteristic(Characteristic.Model, this.accessory.context.model)
      .setCharacteristic(Characteristic.SerialNumber, this.bulb.id);

    let service = this.accessory.getService(Service.Lightbulb);

    if (this.accessory.context.features.color === true) {
      if (service.testCharacteristic(Characteristic.Hue) === false) {
        service.addCharacteristic(Characteristic.Hue);
        this.addEventHandler(service, Characteristic.Hue);
      }

      if (service.testCharacteristic(Characteristic.Saturation) === false) {
        service.addCharacteristic(Characteristic.Saturation);
        this.addEventHandler(service, Characteristic.Saturation);
      }
    }
    else if (service.testCharacteristic(ColorTemperature) === true) {
      service.getCharacteristic(ColorTemperature).setProps({
        maxValue: 370,
        minValue: 154
      });
    }
  }.bind(this));
};

ChromecastAccessory.prototype.updateReachability = function (bulb) {
  this.bulb = bulb;
  this.updateInfo();
};


class ControlChromecast {
  constructor(log, config) {
    this.log = log;
    this.name = config.name;
    this.chromecastDeviceName = config.chromecastDeviceName;
    this.switchOffDelay = config.switchOffDelay || 0;
    this.debug = debug(`homebridge-control-chromecast:${this.chromecastDeviceName}`);

    this.setDefaultProperties(true);

    this.switchService = new Service.Switch(this.name);
    this.switchService
      .getCharacteristic(Characteristic.On)
      .on('get', this.isCasting.bind(this))
      .on('set', this.setCasting.bind(this));

    this.switchService
      .addCharacteristic(CustomCharacteristics.DeviceType)
      .on('get', callback => callback(null, this.deviceType));

    this.switchService
      .addCharacteristic(CustomCharacteristics.DeviceIp)
      .on('get', callback => callback(null, this.deviceIp));

    this.switchService
      .addCharacteristic(CustomCharacteristics.DeviceId)
      .on('get', callback => callback(null, this.deviceId));

    this.switchService
      .addCharacteristic(Characteristic.Volume)
      .on('get', callback => callback(null, Math.floor(this.volume * 100)))
      .on('set', this.setVolume.bind(this));

    this.motionService = new Service.MotionSensor(`${this.name} Streaming`);

    this.motionService
      .getCharacteristic(Characteristic.MotionDetected)
      .on('get', this.isCasting.bind(this));

    this.accessoryInformationService = new Service.AccessoryInformation();

    this.accessoryInformationService
      .setCharacteristic(Characteristic.Name, this.name)
      .setCharacteristic(Characteristic.Manufacturer, pkginfo.author.name || pkginfo.author)
      .setCharacteristic(Characteristic.Model, pkginfo.name)
      .setCharacteristic(Characteristic.SerialNumber, 'n/a')
      .setCharacteristic(Characteristic.FirmwareRevision, pkginfo.version)
      .setCharacteristic(Characteristic.HardwareRevision, pkginfo.version);

    this.detectChromecast();
  }

  setDefaultProperties(resetIpAndPort = false, stopReconnecting = false) {
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

    this.switchOffDelayTimer = null;

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

  /**
   * Use bonjour to detect Chromecast devices on the network
   */
  detectChromecast() {
    const browser = mdns.createBrowser(mdns.tcp('googlecast'), { resolverSequence: mdnsSequence });

    browser.on('serviceUp', (device) => {
      const txt = device.txtRecord;
      const name = txt.fn;

      if (name.toLowerCase() === this.chromecastDeviceName.toLowerCase()) {
        this.setDefaultProperties(true, true);

        const ipAddress = device.addresses[0];
        const { port } = device;

        this.chromecastIp = ipAddress;
        this.chromecastPort = port;

        this.deviceType = txt.md || '';
        this.deviceIp = `${ipAddress}:${port}`;
        this.deviceId = txt.id;

        this.log(`Chromecast found on ${this.chromecastIp}:${this.chromecastPort}`);

        this.clientConnect();
      }
    });

    // Restart browser every 30 minutes or so to make sure we are listening to announcements
    setTimeout(() => {
      browser.stop();

      this.clientDisconnect(false);
      this.debug('detectChromecast() - Restarting mdns browser');
      this.detectChromecast();
    }, 30 * 60 * 1000);

    this.log(`Searching for Chromecast device named "${this.chromecastDeviceName}"`);
    browser.start();
  }

  clientError(error) {
    this.log(`Chromecast client error - ${error}`);

    this.clientDisconnect(true);
  }

  resetClient() {
    if (this.chromecastClient) {
      try {
        this.chromecastClient.close();
      } catch (e) { // eslint-disable-line
      }
    } else {
      this.chromecastClient = null;
    }
  }

  clientDisconnect(reconnect) {
    this.log('Chromecast connection: disconnected');

    this.setIsCasting(false);
    this.setDefaultProperties(false, true);

    if (reconnect) {
      if (this.reconnectCounter > 150) { // Backoff after 5 minutes
        this.log('Chromecast reconnection: backoff, searching again for Chromecast');
        this.detectChromecast();
        return;
      }

      this.log('Waiting 2 seconds before reconnecting');

      this.reconnectTimer = setTimeout(() => {
        this.reconnectCounter = this.reconnectCounter + 1;
        this.clientConnect();
      }, 2000);
    }
  }

  clientConnect() {
    this.chromecastClient = new CastClient();

    const connectionDetails = {
      host: this.chromecastIp,
      port: this.chromecastPort,
    };

    this.chromecastClient
      .on('status', this.processClientStatus.bind(this))
      .on('timeout', () => this.debug('chromeCastClient - timeout'))
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
          .on('timeout', () => this.debug('chromeCastClient.connection - timeout'))
          .on('disconnect', () => this.clientDisconnect(true));

        this.chromecastClient.heartbeat
          .on('timeout', () => this.debug('chromeCastClient.heartbeat - timeout'))
          .on('pong', () => null);

        this.chromecastClient.receiver
          .on('status', this.processClientStatus.bind(this));

        // Force to detect the current status in order to initialise processClientStatus() at boot
        this.chromecastClient.getStatus((err, status) => this.processClientStatus(status));
      }
    });
  }

  processClientStatus(status) {
    this.debug('processClientStatus() - Received client status', status);

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
              this.debug('processClientStatus() - New media');
              // Force to detect the current status in order to initialise at boot
              media.getStatus((err, mediaStatus) => this.processMediaStatus(mediaStatus));
              media.on('status', this.processMediaStatus.bind(this));
              this.castingMedia = media;
            },
          );
        } catch (e) {
          // Handle exceptions like "Cannot read property 'createChannel' of null"
          this.debug('processClientStatus() - Exception', e);
          this.clientDisconnect(true);
        }
      }
    } else {
      this.castingMedia = null;
      this.debug('processClientStatus() - Reset media');
    }

    // Process "Stop casting" command
    if (typeof status.applications === 'undefined') {
      this.debug('processClientStatus() - Stopped casting');
      this.setIsCasting(false);
    }

    // Process volume
    if (status.volume && 'level' in status.volume) {
      this.volume = status.volume.level;
    }
  }

  processMediaStatus(status) {
    this.debug('processMediaStatus() - Received media status', status);

    if (status && status.playerState) {
      if (status.playerState === 'PLAYING' || status.playerState === 'BUFFERING') {
        this.setIsCasting(true);
      } else {
        this.setIsCasting(false);
      }
    }
  }

  setIsCasting(statusBool) {
    // Update the internal state and log only if there's been a change of state
    if (statusBool !== this.isCastingStatus) {
      if (statusBool) {
        this.log('Chromecast is now playing');
        this.isCastingStatus = true;
      } else {
        this.log('Chromecast is now stopped');
        this.isCastingStatus = false;
      }

      this.switchService.setCharacteristic(Characteristic.On, this.isCastingStatus);

      const updateMotionSensor = () => {
        this.motionService.setCharacteristic(Characteristic.MotionDetected, this.isCastingStatus);
        this.log(`Motion sensor ${this.isCastingStatus ? 'is detecting movements' : 'stopped detecting movements'}`);
      };

      if (!this.isCastingStatus && this.switchOffDelay) {
        this.switchOffDelayTimer = setTimeout(updateMotionSensor, this.switchOffDelay);
      } else {
        if (this.switchOffDelayTimer) {
          clearTimeout(this.switchOffDelayTimer);
        }
        updateMotionSensor();
      }
    }
  }

  getServices() {
    return [
      this.switchService,
      this.motionService,
      this.accessoryInformationService,
    ];
  }

  /**
   * Is the Chromecast currently receiving an audio/video stream?
   *
   * @param {function} callback
   */
  isCasting(callback) {
    callback(null, this.isCastingStatus);
  }

  /**
   * Set the Chromecast volume
   *
   * @param {int} volume
   * @param {function} callback
   */
  setVolume(volume, callback) {
    const currentValue = this.volume;

    this.debug(`setVolume() - Current status: ${currentValue} - New status: ${volume}`);

    if (this.chromecastClient) {
      try {
        this.chromecastClient.setVolume({ level: volume / 100 }, () => callback());
      } catch (e) {
        this.debug('setVolume() - Reported error', e);
        callback();
      }
    }
  }

  /**
   * Start/stop the Chromecast from receiving an audio/video stream
   *
   * @param {boolean} on
   * @param {function} callback
   */
  setCasting(on, callback) {
    const currentlyCasting = this.isCastingStatus;
    this.setIsCasting(on);

    this.debug(`setCasting() - Current status: ${currentlyCasting} - New status: ${on}`);

    if (!this.castingMedia) {
      callback();
      return;
    }

    if (on && !currentlyCasting) {
      this.debug('setCasting() - Play');
      this.castingMedia.play(() => null);
    } else if (!on && currentlyCasting) {
      this.debug('setCasting() - Stop');
      this.castingMedia.stop(() => null);
    }
    callback();
  }
}

// eslint-disable-next-line func-names
module.exports = function (homebridge) {
  PlatformAccessory = homebridge.platformAccessory; 

  Characteristic = homebridge.hap.Characteristic; 
  Service = homebridge.hap.Service; 
  UUIDGen = homebridge.hap.uuid;


  homebridge.registerPlatform('homebridge-control-chromecast', 'ControlChromecast', ControlChromecastPlatform, true);
};