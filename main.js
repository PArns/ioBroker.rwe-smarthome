"use strict";

String.prototype.capitalize = function () {
    return this.charAt(0).toUpperCase() + this.toLowerCase().slice(1);
};

String.prototype.replaceAll = function (search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

var utils = require(__dirname + '/lib/utils'); // Get common adapter utils
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

                if (device)
                    device.setState(state.val, function () {
                        adapter.setState(getDeviceName(device), {
                            val: obj.native.friendlyState ? device.getFriendlyState() : device.getState(),
                            ack: true
                        });
                    });
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
        smartHomeInstance.login(adapter.config.user, adapter.config.password, function (res, error) {
            if (res) {
                smartHomeInstance.init(initSmartHome);
                smartHomeInstance.on("StatusChanged", function (aDevice) {
                    adapter.getObject(getDeviceName(aDevice), function (err, obj) {
                        if (obj) {
                            adapter.setState(getDeviceName(aDevice), {
                                val: obj.native.friendlyState ? aDevice.getFriendlyState() : aDevice.getState(),
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

        smartHomeInstance.on("Debug", function (debugObject) {
            adapter.log.info("DEBUG INFO: " + JSON.stringify(debugObject));
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

            case "HumiditySensor":
            case "TemperatureSensor":
            case "PushButtonSensor":
            case "SmokeDetectorSensor":
            case "ValveActuator":
                // ignore
                break;
            default:
                adapter.log.info("UNKNOWN DEVICE TYPE " + device.Type);
        }
    });
}

function getDeviceName(aDevice) {
    var room = smartHomeInstance.getRoomById(aDevice.LCID);
    return room.Name.capitalize() + "." + aDevice.Name.replaceAll(" ", "-");
}

function addDevice(aDevice, common, type, useFriendlyState) {
    var deviceName = getDeviceName(aDevice);

    if (typeof type == "undefined")
        type = "state";

    var currentState = false;

    if (typeof useFriendlyState == "undefined") {
        currentState = aDevice.getState();
        useFriendlyState = false;
    } else if (useFriendlyState === true)
        currentState = aDevice.getFriendlyState()

    adapter.setObjectNotExists(deviceName, {
        type: type,
        common: common,
        native: {
            id: aDevice.Id,
            friendlyState: useFriendlyState
        }
    });

    adapter.setState(deviceName, {val: currentState, ack: true});
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
        role: role
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
            write = false;
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
        role: "sensor.fire"
    });
}

function addRollerShutterActuator(aActuator) {
    addDevice(aActuator, {
        name: aActuator.Name,
        type: "number",
        role: "value.position",
        write: false,
        unit: "%"
    });
}

function addRoomHumiditySensor(aSensor) {
    addDevice(aSensor, {
        name: aSensor.Name,
        type: "number",
        role: "value.humidity",
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
        role: "value.temperature",
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
        type: 'string',
        role: role,
        write: false,
        list: ["OPEN", "CLOSED"]
    }, "state", true);
}