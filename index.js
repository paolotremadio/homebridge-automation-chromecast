const mdns = require('mdns');
const CastClient = require('castv2-client').Client;
const CastDefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const CustomCharacteristics = require('./custom-characteristics');

let Service, Characteristic;

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory('homebridge-automation-chromecast', 'AutomationChromecast', AutomationChromecast);
};

const mdnsSequence = [
  mdns.rst.DNSServiceResolve(),
  'DNSServiceGetAddrInfo' in mdns.dns_sd ? mdns.rst.DNSServiceGetAddrInfo() : mdns.rst.getaddrinfo({families: [0]}),
  mdns.rst.makeAddressesUnique()
];

class AutomationChromecast {
  constructor(log, config) {
    this.log = log;
    this.name = config['name'];
    this.chromecastDeviceName = config['chromecastDeviceName'];


    this.chromecastIp = null;
    this.chromecastPort = null;
    this.chromecastClient = null;

    this.isCastingStatus = false;
    this.castingApplication = null;
    this.castingMedia = null;

    this.switchService = new Service.Switch(this.name);
    this.switchService
      .getCharacteristic(Characteristic.On)
      .on('get', this.isCasting.bind(this))
      .on('set', this.setCasting.bind(this));


    this.deviceType = null;
    this.deviceIp = null;
    this.deviceId = null;

    this.switchService
      .addCharacteristic(CustomCharacteristics.DeviceType)
      .on('get', (callback) => callback(null, this.deviceType));

    this.switchService
      .addCharacteristic(CustomCharacteristics.DeviceIp)
      .on('get', (callback) => callback(null, this.deviceIp));

    this.switchService
      .addCharacteristic(CustomCharacteristics.DeviceId)
      .on('get', (callback) => callback(null, this.deviceId));


    this.motionService = new Service.MotionSensor(`${this.name} Streaming`);

    this.motionService
      .getCharacteristic(Characteristic.MotionDetected)
      .on('get', this.isCasting.bind(this));

    this.detectDevice();
  }

  /**
   * Use bonjour to detect Chromecast devices on the network
   */
  detectDevice() {
    const browser = mdns.createBrowser(mdns.tcp('googlecast'), {resolverSequence: mdnsSequence});

    browser.on('serviceUp', device => {
      const txt = device.txtRecord;
      const name = txt.fn;

      if (name.toLowerCase() === this.chromecastDeviceName.toLowerCase()) {
        const ipAddress = device.addresses[0];
        const port = device.port;

        this.chromecastIp = ipAddress;
        this.chromecastPort = port;

        this.deviceType = txt.md || '';
        this.deviceIp = `${ipAddress}:${port}`;
        this.deviceId = txt.id;

        this.log(`Chromecast found on ${this.chromecastIp}. Connecting...`);
        browser.stop();

        this.initConnection();
      }
    });

    this.log(`Scanning for Chromecast device with name "${this.chromecastDeviceName}"`);
    browser.start();
  }

  initConnection() {
    this.chromecastClient = new CastClient();

    const connectionDetails = {
      host: this.chromecastIp,
      port: this.chromecastPort,
    };

    this.chromecastClient
      .on('status', this.processClientStatus.bind(this))
      .on('error', status => this.log(status));

    this.chromecastClient.connect(connectionDetails, () => {
      if (this.chromecastClient.connection && this.chromecastClient.heartbeat && this.chromecastClient.receiver) {
        this.log('Chromecast connection: connected');

        this.chromecastClient.connection
          .on('disconnect', () => this.log('Chromecast connection: disconnected.'));

        this.chromecastClient.heartbeat
          .on('timeout', () => this.log('Chromecast connection: timeout.'))
          .on('pong', () => null);

        this.chromecastClient.receiver
          .on('status', this.processClientStatus.bind(this));

        // Force to detect the current status in order to initialise processClientStatus() at boot
        this.chromecastClient.getStatus((err, status) => this.processClientStatus(status));
      }
    });
  }

  processClientStatus(status) {
    // console.log('CLIENT STATUS');
    const applications = status.applications;
    const currentApplication = applications && applications.length > 0 ? applications[0] : null;

    if (currentApplication) {
      const lastMonitoredApplicationStatusId = this.castingApplication ? this.castingApplication.sessionId : null;

      if (currentApplication.sessionId !== lastMonitoredApplicationStatusId) {
        this.castingApplication = currentApplication;

        // NOTE: The castv2-client library has not been updated in a while. The current version of Chromecast protocol
        // does NOT include transportId when streaming to a group of speakers. The transportId is often the sessionId.
        // Assigning the transportId to the sessionId makes the library works with group of speakers in Chromecast Audio.
        this.castingApplication.transportId = this.castingApplication.sessionId;

        this.chromecastClient.join(this.castingApplication, CastDefaultMediaReceiver, (_, media) => {
          // console.log('New media');
          // Force to detect the current status in order to initialise processMediaStatus() at boot
          media.getStatus((err, status) => this.processMediaStatus(status));
          media.on('status', this.processMediaStatus.bind(this));
          this.castingMedia = media;
        });
      }
    } else {
      this.castingMedia = null;
      // console.log('Reset media');
    }

    // Process "Stop casting" command
    if (typeof status.applications === 'undefined') {
      this.log('Stopped casting');
      this.setIsCasting(false);
    }
  }

  processMediaStatus(status) {
    // console.log('MEDIA STATUS');
    if (status && status.playerState) {
      if (status.playerState === 'PLAYING' || status.playerState === 'BUFFERING') {
        this.setIsCasting(true);
      } else {
        this.setIsCasting(false);
      }
    }
  }


  setIsCasting(statusBool) {
    if (statusBool) {
      this.log('Chromecast is now playing');
      this.isCastingStatus = true;
    } else {
      this.log('Chromecast has stopped');
      this.isCastingStatus = false;
    }

    this.switchService.setCharacteristic(Characteristic.On, this.isCastingStatus);
    this.motionService.setCharacteristic(Characteristic.MotionDetected, this.isCastingStatus);
  }

  getServices() {
    return [this.switchService, this.motionService];
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
   * Start/stop the Chromecast from receiving an audio/video stream
   *
   * @param {boolean} on
   * @param {function} callback
   */
  setCasting(on, callback) {
    const currentlyCasting = this.isCastingStatus;
    this.isCastingStatus = on;
    this.motionService.setCharacteristic(Characteristic.MotionDetected, this.isCastingStatus);

    // console.log('New status: ', on, 'Current status', currentlyCasting);

    if (!this.castingMedia) {
      callback();
      return;
    }

    if (on && !currentlyCasting) {
      // console.log('Turning on');
      this.castingMedia.play(() => callback());
    } else if (!on && currentlyCasting) {
      // console.log('Turning off');
      this.castingMedia.stop(() => callback());
    }
  }
}