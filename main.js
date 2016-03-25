"use strict";

var utils = require(__dirname + '/lib/utils'); // Get common adapter utils
var smartHome = require("node-rwe-smarterhome-lib");
var adapter = utils.adapter('rwe-smarthome');

var smartHomeInstance = null;

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
    // Warning, obj can be null if it was deleted
    // adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    adapter.getForeignObject(id, function (err, obj) {
        if (err) {
            adapter.log.error(err);
        } else {
            if (state && !state.ack) {
                var device = smartHomeInstance.getDeviceById(obj.native.id);

                if (device)
                    device.setState(state.val);
            }
        }
    });
});

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
                    adapter.log.info("STATE CHANGED FOR " + aDevice.Name  + " TO " + aDevice.getState());
                    adapter.setState(aDevice.Id, {val: aDevice.getState(), ack: true});
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
        //adapter.log.info(device.Name + " (" + device.Id + ", " + device.Type + "): " + device.getFriendlyState());

        switch (device.Type) {
            case "SwitchActuator":
                addSwitch(device);
                break;
            case "GenericActuator":
                addGenericActuator(device);
                break;
            default:
            //adapter.log.info("UNKNOWN DEVICE TYPE " + device.Type);
        }
    });
}

function addSwitch(aSwitch) {
    var role = null;

    switch (aSwitch.ActCls) {
        case "Light":
            role = "switch";
            break;
        default:
            role = "switch";
    }

    adapter.setObject(aSwitch.Id, {
        type: "state",
        common: {
            name: aSwitch.Name,
            type: 'boolean',
            role: role
        },
        native: {
            id: aSwitch.Id
        }
    });

    adapter.setState(aSwitch.Id, {val: aSwitch.getState(), ack: true});
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
    }

    adapter.setObject(aActuator.Id, {
        type: "state",
        common: {
            name: aActuator.Name,
            type: type,
            role: role,
            write: write
        },
        native: {
            id: aActuator.Id
        }
    });

    adapter.setState(aActuator.Id, {val: aActuator.getState(), ack: true});
}