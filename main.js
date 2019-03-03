"use strict";

String.prototype.capitalize = function () {
    return this.charAt(0).toUpperCase() + this.toLowerCase().slice(1);
};

String.prototype.replaceAll = function (search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

var utils = require('@iobroker/adapter-core'); // Get common adapter utils
var smartHome = require("node-rwe-smarterhome-lib");
var adapter = utils.adapter('rwe-smarthome');

var smartHomeInstance = null;

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        smartHomeInstance.shutdown(function () {
            adapter.log.info('cleaned everything up...');
            callback();
        });
    } catch (e) {
        callback();
    }
});

// is called if a subscribed object changes
adapter.on('objectChange', statusChanged);

// is called if a subscribed state changes
adapter.on('stateChange', statusChanged);

function statusChanged(id, state) {
    adapter.getForeignObject(id, function (err, obj) {
        if (err) {
            adapter.log.error(err);
        } else {
            if (state && !state.ack) {
                var device = smartHomeInstance.getDeviceById(obj.native.id);
                
                if (device) {
                    var cVal = device.setState(state.val);

                    if (cVal !== state.val) {
                        adapter.setState(getDeviceName(device), {
                            val: cVal,
                            ack: true
                        });
                    }
                }
            }
        }
    });
}

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    if (typeof obj == 'object' && obj.message) {
        if (obj.command == 'send') {
            // e.g. send email or pushover or whatever
            console.log('send command');

            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    if (adapter.config.ip && adapter.config.user && adapter.config.password) {
        smartHomeInstance = new smartHome(adapter.config.ip);

        smartHomeInstance.on("Debug", function (debugObject) {
            adapter.log.info("DEBUG INFO: " + JSON.stringify(debugObject));
        });
        
        smartHomeInstance.login(adapter.config.user, adapter.config.password, function (res, error) {
            if (res) {
                smartHomeInstance.init(initSmartHome);

                smartHomeInstance.on("StatusChanged", function (aDevice) {
                    adapter.getObject(getDeviceName(aDevice), function (err, obj) {
                        if (obj) {
                            adapter.setState(getDeviceName(aDevice), {
                                val: aDevice.getState(),
                                ack: true
                            });
                        }
                    });
                });

                // in this template all states changes inside the adapters namespace are subscribed
                adapter.subscribeStates('*');
            } else {
                adapter.log.error(JSON.stringify(error));
            }
        });
    } else {
        adapter.log.error("RWE SmartHome is missing login data! Please go to the module admin and add login information");
    }
});

function initSmartHome() {
    var devices = smartHomeInstance.devices;

    devices.forEach(function (device) {
        switch (device.Type) {
            case "SwitchActuator":
                addSwitchActuator(device);
                break;
            case "GenericActuator":
                addGenericActuator(device);
                break;
            case "AlarmActuator":
                addAlarmActuator(device);
                break;
            case "RoomTemperatureActuator":
                addRoomTemperatureActuator(device);
                break;
            case "RollerShutterActuator":
                addRollerShutterActuator(device);
                break;
            case "RoomHumiditySensor":
                addRoomHumiditySensor(device);
                break;
            case "RoomTemperatureSensor":
                addRoomTemperatureSensor(device);
                break;
            case "WindowDoorSensor":
                addWindowDoorSensor(device);
                break;
            case "LuminanceSensor":
                addLuminanceSensor(device);
                break;
            case "GenericSensor":
            case "HumiditySensor":
            case "TemperatureSensor":
            case "PushButtonSensor":
            case "SmokeDetectorSensor":
            case "ValveActuator":
            case "ThermostatActuator":
            case "MotionDetectionSensor":
                // ignore
                break;
            default:
                adapter.log.info("UNKNOWN DEVICE TYPE " + device.Type + " WITH NAME " + device.Name);
        }
    });
}

function getDeviceName(aDevice) {
    var room = smartHomeInstance.getRoomById(aDevice.LCID);
    return room.Name.capitalize() + "." + aDevice.Name.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-");
}

function addDevice(aDevice, common, type) {
    var deviceName = getDeviceName(aDevice);

    if (typeof type == "undefined")
        type = "state";
    
    adapter.setObjectNotExists(deviceName, {
        type: type,
        common: common,
        native: {
            id: aDevice.Id
        }
    });

    adapter.setState(deviceName, {val: aDevice.getState(), ack: true});
}

function addSwitchActuator(aSwitch) {
    var role = null;

    switch (aSwitch.ActCls) {
        case "Light":
            role = "switch"; // <- light.switch is not homekit compatible
            break;
        default:
            role = "switch";
    }

    addDevice(aSwitch, {
        name: aSwitch.Name,
        type: 'boolean',
        role: role,
        states: {
            "true": "ON",
            "false": "OFF"
        }
    });
}

function addGenericActuator(aActuator) {
    var role = null;
    var type = null;
    var write = true;

    switch (aActuator.State.State.PropertyType) {
        case "BooleanProperty":
            type = "boolean";
            role = "switch";
            write = true;
            break;
        case "StringProperty":
            type = "string";
            role = "indicator";
            write = false;
            break;
        case "NumericProperty":
            type = "number";
            role = "indicator";
            write = true;
            break;
        case "DateTimeProperty":
            type = "object";
            role = "indicator";
            write = false;
            break;
        default:
            console.log("UNKNOWN PROPERTY FOR GENERIC SENSOR " + aActuator.State.State.PropertyType);
            return;
    }

    addDevice(aActuator, {
        name: aActuator.Name,
        type: type,
        role: role,
        write: write
    });
}

function addAlarmActuator(aActuator) {
    addDevice(aActuator, {
        name: aActuator.Name,
        type: "boolean",
        role: "sensor.fire",
        write: false,
        states: {
            "true": "ALARM",
            "false": "NO ALARM"
        }
    });
}

function addRollerShutterActuator(aActuator) {
    addDevice(aActuator, {
        name: aActuator.Name,
        type: "number",
        role: "level.blind",
        write: true,
        unit: "%",
        min: 0,
        max: 100
    });
}

function addRoomTemperatureActuator(aActuator) {
    addDevice(aActuator, {
        name: aActuator.Name,
        type: "number",
        role: "level.temperature",
        write: true,
        unit: "°C"
    });
}

function addRoomHumiditySensor(aSensor) {
    addDevice(aSensor, {
        name: aSensor.Name,
        type: "number",
        role: "sensor.humidity",
        write: false,
        unit: "%",
        min: 0,
        max: 100
    });
}

function addRoomTemperatureSensor(aSensor) {
    addDevice(aSensor, {
        name: aSensor.Name,
        type: "number",
        role: "sensor.temperature",
        write: false,
        unit: "°C"
    });
}

function addWindowDoorSensor(aSensor) {
    var role = null;

    switch (aSensor.Installation) {
        case "Window":
            role = "sensor.window";
            break;
        case "Door":
            role = "sensor.door";
            break;
        default:
            adapter.log.info(JSON.stringify(aSensor.Installation));
            role = "switch";
    }

    addDevice(aSensor, {
        name: aSensor.Name,
        type: "boolean",
        role: role,
        write: false,
        states: {
            "true": "OPEN",
            "false": "CLOSED"
        }
    });
}

function addLuminanceSensor(aSensor) {
    addDevice(aSensor, {
        name: aSensor.Name,
        type: "number",
        role: "sensor.luminance",
        write: false,
        unit: "%",
        min: 0,
        max: 100
    });
}