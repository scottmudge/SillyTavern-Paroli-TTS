/*

    TODO:
        * Add support for speaker list, tie in with ST

*/

import { extension_settings, getContext, loadExtensionSettings } from "../../extensions.js";
import { saveSettingsDebounced } from "../../../script.js";
import PCMPlayer from "./pcm-player.js"


const extensionName = "sillytavern-paroli-tts";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}/`;
const extensionSettings = extension_settings[extensionName];
const appendURL = "api/v1/stream";

var ws;
var pcmplayer_opt = {
    encoding: '16bitInt',
    channels: 1,
    sampleRate: 22050,
    flushingTime: 250
}
var player = new PCMPlayer(pcmplayer_opt);
var error_ts = 0;
var cur_state = 0; // 0 == error/disconnect, 1 == good

const defaultSettings = { 
    tts_enabled: true,
    server_address: "http://localhost:8848/",
    volume: 1.0,
    length_scale: 1.0,
    noise_scale: 0.667,
    noise_width: 0.8,
    sample_rate: 22050
};

async function loadSettings() {
    // Create settings if they don't exist
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }

    // Update settings in the UI
    $("#enable_tts_setting").prop("checked", extension_settings[extensionName].tts_enabled).trigger("input");

    $("#server_address_setting").val(extension_settings[extensionName].server_address);

    $("#volume_slider").val(extension_settings[extensionName].volume);
    $("#volume_slider_value").text(extension_settings[extensionName].volume);
    player.volume(parseFloat(extension_settings[extensionName].volume));

    $("#length_scale_slider").val(extension_settings[extensionName].length_scale);
    $("#length_scale_slider_value").text(extension_settings[extensionName].length_scale);

    $("#noise_scale_slider").val(extension_settings[extensionName].noise_scale);
    $("#noise_scale_slider_value").text(extension_settings[extensionName].noise_scale);

    $("#noise_width_slider").val(extension_settings[extensionName].noise_width);
    $("#noise_width_slider_value").text(extension_settings[extensionName].noise_width);

    // @ts-ignore
    $("#sample_rate_dropdown").val(extension_settings[extensionName].sample_rate);
}

function getServerURL() {
    var addr = extension_settings[extensionName].server_address;
    if (!addr.endsWith("/")) addr += "/";
    addr += appendURL;
    if (addr.includes('https:'))
        addr = addr.replace('https', 'ws')
    else if (addr.includes('http:'))
        addr = addr.replace('http:', 'ws:')
    if (addr.includes('ws:') && !addr.startsWith('ws://'))
        addr = addr.replace('ws:', 'ws://')
    if (!addr.startsWith('ws://'))
        addr = 'ws://' + addr
    return addr;
}

function setServerState(state) {
    if (state == 'good') {
        $("#server_status_text").removeClass("paroli-tts-extension-text-error");
        $("#server_status_text").addClass("paroli-tts-extension-text-success");
        $("#server_status_text").text("Connected");
        cur_state = 1;
    }
    else if (state == 'error') {
        $("#server_status_text").removeClass("paroli-tts-extension-text-success");
        $("#server_status_text").addClass("paroli-tts-extension-text-error");
        $("#server_status_text").text("Error");
        error_ts = performance.now();
        cur_state = 0;
    }
    else {
        $("#server_status_text").removeClass("paroli-tts-extension-text-success");
        $("#server_status_text").addClass("paroli-tts-extension-text-error");
        $("#server_status_text").text("Disconnected");
        error_ts = performance.now();
        cur_state = 0;
    }
}

function reconnectWS(connect_fn) {
    if (ws) ws.close();
    setServerState('discon');

    ws = new WebSocket(getServerURL());
    // Create a promise to handle the asynchronous connection
    const wsConnectedPromise = new Promise((resolve, reject) => {
        // Set a timeout to check the connection state after a slight delay
        setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
            resolve(); // Connection successful
        } else {
            reject(new Error("WebSocket connection failed")); // Connection failed
        }
        }, 100); // Adjust the delay (in milliseconds) as needed
    });
    
    ws.binaryType = "arraybuffer";
    ws.addEventListener('open', function (event) {
        connect_fn && connect_fn();
    });
    ws.addEventListener('message', function (event) {
        if (typeof event.data == "string") {
            let msg = JSON.parse(event.data);
            if (msg["status"] == "ok")
                return;
            console.error("Paroli TTS Error -- Status: " + msg['status'] + ' | Message: '  + msg['message']);
            setServerState('error');
            return;
        }
        if (cur_state !== 1) setServerState('good');
        var data = new Uint8Array(event.data);
        if (data.length == 0) return;
        player.feed(data);
    });

    // Handle the promise outcome (connection success or failure)
    wsConnectedPromise.then(() => {
        var newTime = performance.now();
        if ((newTime - error_ts) < 500) {
            setServerState('error');
        }
        else {
            setServerState('good');
            console.log("Paroli TTS websocket connection established successfully!");
        }
    }).catch(error => {
        setServerState('discon');
        console.error("Paroli TTS webSocket connection failed:", error);
        // Handle connection failure (e.g., retry)
    });
}


function runTTS(tts_text) {
    let data = JSON.stringify({
        text: tts_text,
        speaker_id: null,
        audio_format: 'pcm',
        length_scale: parseFloat(extension_settings[extensionName].length_scale),
        noise_scale: parseFloat(extension_settings[extensionName].noise_scale),
        noise_w: parseFloat(extension_settings[extensionName].noise_width)
    });

    if (ws == null || ws.readyState != 1) {
        reconnectWS(function () {
            ws.send(data);
        });
        return;
    }

    ws.send(data);
}


function onTestTTSButtonClick() {
    runTTS("Hello, world! What is this SillyTavern thing, anyway?");
}

// Event listeners
// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
function onEnableTTSIInput(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].tts_enabled = value;
    saveSettingsDebounced();
}

function onServerAddressInput(event) {
    const value = $(event.target).val();
    extension_settings[extensionName].server_address = value;
    saveSettingsDebounced();
}

function onVolumeSliderInput(event) {
    const value = $(event.target).val();
    player.volume(parseFloat(value));
    extension_settings[extensionName].volume = value;
    $("#volume_slider_value").text(extension_settings[extensionName].volume);
    saveSettingsDebounced();
}

function onLengthScaleSliderInput(event) {
    const value = $(event.target).val();
    extension_settings[extensionName].length_scale = value;
    $("#length_scale_slider_value").text(extension_settings[extensionName].length_scale);
    saveSettingsDebounced();
}

function onNoiseScaleSliderInput(event) {
    const value = $(event.target).val();
    extension_settings[extensionName].noise_scale = value;
    $("#noise_scale_slider_value").text(extension_settings[extensionName].noise_scale);
    saveSettingsDebounced();
}

function onNoiseWidthSliderInput(event) {
    const value = $(event.target).val();
    extension_settings[extensionName].noise_width = value;
    $("#noise_width_slider_value").text(extension_settings[extensionName].noise_width);
    saveSettingsDebounced();
}

function onSampleRateDropdownInput(event) {
    const value = $(event.target).val();
    extension_settings[extensionName].sample_rate = value;
    saveSettingsDebounced();
}
// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

// Called when extension is loaded
jQuery(async () => {
    var url = `${extensionFolderPath}settings.html`.replace('/third-party', '');
    // Append the settings html to the existing settings column. extension_settings is left and deals with system/gen settings,
    // and extension_settings2 is on the right and deals with UI stuff.
    const settingsHtml = await $.get(url);
    $("#extensions_settings").append(settingsHtml);

    // Add event listeners
    $("#enable_tts_setting").on("input", onEnableTTSIInput);
    $("#test_tts_buttom").on("click", onTestTTSButtonClick);
    $("#server_address_setting").on("input", onServerAddressInput);
    $("#volume_slider").on("input", onVolumeSliderInput);
    $("#length_scale_slider").on("input", onLengthScaleSliderInput);
    $("#noise_scale_slider").on("input", onNoiseScaleSliderInput);
    $("#noise_width_slider").on("input", onNoiseWidthSliderInput);
    $("#sample_rate_dropdown").on("input", onSampleRateDropdownInput);

    // Load settings
    loadSettings();
})