const init = (Characteristic) => {
  const DeviceTypeUUID = '2af07946-01da-11e8-ba89-0ed5f89f718b';
  const DeviceType = function () {
    const char = new Characteristic('Type', DeviceTypeUUID);

    char.setProps({
      format: Characteristic.Formats.STRING,
      perms: [Characteristic.Perms.READ],
    });
    char.value = char.getDefaultValue();
    return char;
  };
  DeviceType.UUID = DeviceTypeUUID;


  const DeviceIdUUID = 'e4f54456-01db-11e8-ba89-0ed5f89f718b';
  const DeviceId = function () {
    const char = new Characteristic('ID', DeviceIdUUID);

    char.setProps({
      format: Characteristic.Formats.STRING,
      perms: [Characteristic.Perms.READ],
    });
    char.value = char.getDefaultValue();
    return char;
  };
  DeviceId.UUID = DeviceIdUUID;


  const DeviceIpUUID = 'fbe3a810-01db-11e8-ba89-0ed5f89f718b';
  const DeviceIp = function () {
    const char = new Characteristic('IP Address', DeviceIpUUID);

    char.setProps({
      format: Characteristic.Formats.STRING,
      perms: [Characteristic.Perms.READ],
    });
    char.value = char.getDefaultValue();
    return char;
  };
  DeviceIp.UUID = DeviceIpUUID;

  return {
    DeviceType,
    DeviceId,
    DeviceIp,
  };
};

module.exports = init;
