import {deviceControlError, MAX_ADDITIONAL_DEVICES, migrateDeviceControl} from './deviceControlModel.mjs';

const labels = {
  robot: '焊接机器人',
  coarse: '粗定位相机',
  precision: '精定位相机',
  camera: '相机',
};

export function workstationPrecisionBrand(device) {
  const brand = device.brand ?? '';
  if (/^(yinglai|英莱)/i.test(brand)) return 'yinglai';
  if (/^(weijing|vizum|伟景)/i.test(brand)) return 'weijing';
  const type = device.properties?.find(property => property.name === 'sensor_type')?.value ?? '';
  if (/线激光|line[ _-]?laser/i.test(type)) return 'yinglai';
  if (/结构光|structured[ _-]?light/i.test(type)) return 'weijing';
  return null;
}

export function enabledWorkstationRobots(devices, settings) {
  const robots = devices.filter(device => device.kind === 'robot' && !device.configured).map(device => device.id);
  const enabled = robots.filter(id => settings?.enabledRobotIds?.includes(id) ?? true);
  return enabled.length ? enabled : robots;
}

export function workstationConfiguredDevices(devices, settings) {
  const removed = new Set(settings?.removedDeviceIds);
  return [...devices.filter(device => device.kind === 'robot' || !removed.has(device.id)),
    ...(settings?.additionalDevices ?? []).map(device => ({...device, bindings: [], configured: true}))];
}

export function workstationPrecisionByRobot(devices, settings) {
  const installed = workstationConfiguredDevices(devices, settings).filter(device => device.kind === 'precision');
  return Object.fromEntries(enabledWorkstationRobots(devices, settings).map(id => {
    const attached = installed.filter(device => !device.robotId || device.robotId === id);
    return [id,{
      laserPrecision:attached.some(device => !device.configured && workstationPrecisionBrand(device) === 'yinglai'),
      structuredLightPrecision:attached.some(device => workstationPrecisionBrand(device) === 'weijing')
    }];
  }));
}

export function addWorkstationDevice(devices, settings, entry) {
  const {kind, brand, robotId, id} = entry;
  if (!['robot', 'coarse', 'precision'].includes(kind) || !id ||
      kind === 'precision' && !['weijing', 'yinglai'].includes(brand)) throw Error('请选择有效的设备类型或品牌');
  if (kind === 'precision' && !devices.some(device => device.kind === 'robot' && device.id === robotId))
    throw Error('请选择精定位相机安装的机械臂');
  const installed = device => device.kind === kind && (kind !== 'precision' ||
    workstationPrecisionBrand(device) === brand && device.robotId === robotId);
  const removed = settings.removedDeviceIds ?? [];
  const restore = devices.find(device => removed.includes(device.id) && installed(device));
  if (restore) return {...settings, removedDeviceIds: removed.filter(id => id !== restore.id)};
  const additional = settings.additionalDevices ?? [];
  if (additional.length >= MAX_ADDITIONAL_DEVICES || [...devices, ...additional].some(device => device.id === id))
    throw Error('设备数量超出限制或编号重复');
  if (kind === 'precision' && workstationConfiguredDevices(devices, settings).some(installed))
    throw Error('所选机械臂已安装该类型的精定位相机');
  return {...settings, additionalDevices: [...additional, entry]};
}

export function removeWorkstationDevice(devices, settings, id) {
  const next = settings.coarseCameraId===id ? {...settings,coarseCameraId:undefined} : settings;
  if (settings.additionalDevices?.some(device => device.id === id)) {
    const {[id]: removed, ...profiles} = settings.profiles ?? {};
    return {...next, profiles, additionalDevices: settings.additionalDevices.filter(device => device.id !== id)};
  }
  if (!devices.some(device => device.id === id && ['precision', 'coarse'].includes(device.kind))) return settings;
  return {...next, removedDeviceIds: [...new Set([...(settings.removedDeviceIds ?? []), id])]};
}

export function workstationDeviceProfiles(devices, settings) {
  const defaults = migrateDeviceControl();
  const counts = new Map();
  return workstationConfiguredDevices(devices, settings).filter(device => Object.hasOwn(labels, device.kind)).map(device => {
    const number = (counts.get(device.kind) ?? 0) + 1;
    counts.set(device.kind, number);
    const {id, kind, brand, model} = device;
    let defaultConfiguration = {address: '', port: null};
    if (kind === 'robot') defaultConfiguration = defaults.robot;
    if (kind === 'coarse') defaultConfiguration = defaults.coarseCamera;
    const precisionBrand = kind === 'precision' ? workstationPrecisionBrand(device) : null;
    if (precisionBrand) {
      const configuredId = device.properties?.find(property => property.name === 'weldone_configuration_device_id')?.value;
      defaultConfiguration = {...defaults.precisionCamera.profiles[precisionBrand], id: /^\d+$/.test(configuredId) ? Number(configuredId) : null};
    }
    const configured = settings?.profiles?.[id];
    const configuration = {...defaultConfiguration, ...configured,
      brand: device.configured && kind !== 'precision' ? configured?.brand ?? brand ?? '' : brand ?? '',
      model: device.configured ? configured?.model ?? model ?? '' : model ?? ''};
    return {...device, precisionBrand, label: `${labels[kind]} ${number}`, configuration};
  });
}

export function workstationPlanningControl(devices, settings) {
  const defaults = migrateDeviceControl();
  const profiles = workstationDeviceProfiles(devices, settings);
  const [first, ...robots] = profiles.filter(device => device.kind === 'robot' && !device.configured);
  const coarse = profiles.find(device => device.kind === 'coarse' && device.id === settings?.coarseCameraId) ??
    profiles.find(device => device.kind === 'coarse');
  const enabled = enabledWorkstationRobots(devices, settings);
  const precision = profiles.filter(device => device.precisionBrand &&
    (!device.robotId || enabled.includes(device.robotId)) &&
    (!device.configured || device.precisionBrand === 'weijing'));
  const cameraProfiles = {...defaults.precisionCamera.profiles};
  const brands = [...new Set(precision.map(device => device.precisionBrand))];
  for (const brand of brands) cameraProfiles[brand] = precision.find(device => device.precisionBrand === brand).configuration;
  return {
    robotId: first?.id ?? 'robot',
    robot: first?.configuration ?? defaults.robot,
    additionalDevices: robots.map(({id, configuration}) => ({id, type: 'robot', configuration})),
    enabledRobotIds: enabled,
    coarseCamera: coarse?.configuration ?? defaults.coarseCamera,
    precisionCamera: {
      brand: brands[0] ?? 'none',
      brands,
      profiles: cameraProfiles,
    },
  };
}

export function workstationSettingsError(devices, settings) {
  const additional = settings?.additionalDevices ?? [];
  const ids = [...devices, ...additional].map(device => device.id);
  if (new Set(ids).size !== ids.length || additional.length > MAX_ADDITIONAL_DEVICES ||
      additional.some(device => !device.id || !['robot','coarse','precision'].includes(device.kind) ||
        device.kind === 'precision' && (!workstationPrecisionBrand(device) ||
          !devices.some(robot => robot.kind === 'robot' && robot.id === device.robotId)))) return '附加场景设备配置无效';
  const error = deviceControlError(workstationPlanningControl(devices, settings));
  if (error) return error;
  for (const {label, precisionBrand, configuration: {address, port, id}} of workstationDeviceProfiles(devices, settings)) {
    if (typeof address !== 'string' || address.length > 255 ||
        (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535))) {
      return `${label}的地址或端口无效。端口应为 1–65535 的整数。`;
    }
    if (precisionBrand === 'yinglai' && id !== null && (!Number.isInteger(id) || id < 0)) {
      return `${label}的设备 ID 须为非负整数。`;
    }
  }
  return '';
}
