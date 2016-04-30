'use strict';
var gaussian = require('gaussian');
var outliers = require('outliers');
var stats = require('scientific-statistics');

var k = require('./openBCIConstants');

/** Constants for interpreting the EEG data */
// Reference voltage for ADC in ADS1299.
//   Set by its hardware.
const ADS1299_VREF = 4.5;
// Scale factor for aux data
const SCALE_FACTOR_ACCEL = 0.002 / Math.pow(2,4);
// X, Y, Z
const ACCEL_NUMBER_AXIS = 3;
// Default ADS1299 gains array

// For computing Goertzel Algorithm
// See: http://www.embedded.com/design/configurable-systems/4024443/The-Goertzel-Algorithm
// In the tutorial cited above, GOERTZEL_BLOCK_SIZE is referred to as N
const GOERTZEL_BLOCK_SIZE = 62;
const GOERTZEL_K_250 = Math.floor(0.5 + ((GOERTZEL_BLOCK_SIZE * k.OBCILeadOffFrequencyHz) / k.OBCISampleRate250));
const GOERTZEL_W_250 = ((2 * Math.PI) / GOERTZEL_BLOCK_SIZE) * GOERTZEL_K_250;
const GOERTZEL_COEFF_250 = 2 * Math.cos(GOERTZEL_W_250);
// TODO: Add support for 16 channel Daisy board


var sampleModule = {

    /**
     * @description This takes a 33 byte packet and converts it based on the last four bits.
     *                  0000 - Standard OpenBCI V3 Sample Packet
     * @param dataBuf
     * @param channelSettingsArray
     * @returns {Promise}
     */
    parseRawPacket: (dataBuf,channelSettingsArray) => {
        const defaultChannelSettingsArray = k.channelSettingsArrayInit(k.OBCINumberOfChannelsDefault);
        return new Promise((resolve, reject) => {
            if (dataBuf === undefined || dataBuf === null) reject('Error [parseRawPacket]: dataBuf must be defined.');
            // Verify proper start byte
            if (dataBuf[0] != k.OBCIByteStart) reject('Error [parseRawPacket]: Invalid start byte of ' + dataBuf[0].toString(16) + ' expected ' + k.OBCIByteStart.toString(16));
            // channelSettingsArray is optional, defaults to CHANNEL_SETTINGS_ARRAY_DEFAULT
            channelSettingsArray = channelSettingsArray || defaultChannelSettingsArray;
            // Last nibble contains packet type
            var packetType = getRawPacketType(dataBuf[k.OBCIPacketPositionStopByte]);

            switch (packetType) {
                case k.OBCIPacketTypeUserDefined:
                    // Do something with the packet, maybe nothing
                    resolve();
                    break;
                case k.OBCIPacketTypeTimeSynced:
                    // Parse the time synced packet
                    break;
                default: //normal packet
                    parsePacketStandard(dataBuf,channelSettingsArray).then(sampleObject => {
                        resolve(sampleObject);
                    }).catch(err => reject(err));
                    break;
            }

        });
    },

    /**
     * @description Mainly used by the simulator to convert a randomly generated sample into a std OpenBCI V3 Packet
     * @param sample - A sample object
     * @returns {Buffer}
     */
    convertSampleToPacket: function(sample) {
        var packetBuffer = new Buffer(k.OBCIPacketSize);
        packetBuffer.fill(0);

        // start byte
        packetBuffer[0] = k.OBCIByteStart;

        // sample number
        packetBuffer[1] = sample.sampleNumber;

        // channel data
        for (var i = 0; i < k.OBCINumberOfChannelsDefault; i++) {
            var threeByteBuffer = this.floatTo3ByteBuffer(sample.channelData[i]);

            threeByteBuffer.copy(packetBuffer, 2 + (i * 3));
        }

        for (var j = 0; j < 3; j++) {
            var twoByteBuffer = this.floatTo2ByteBuffer(sample.auxData[j]);

            twoByteBuffer.copy(packetBuffer, (k.OBCIPacketSize - 1 - 6) + (i * 2));
        }


        // stop byte
        packetBuffer[k.OBCIPacketSize - 1] = k.OBCIByteStop;

        return packetBuffer;
    },

    debugPrettyPrint: function(sample) {
        if(sample === null || sample === undefined) {
            console.log('== Sample is undefined ==');
        } else {
            console.log('-- Sample --');
            console.log('---- Start Byte: ' + sample.startByte);
            console.log('---- Sample Number: ' + sample.sampleNumber);
            for(var i = 0; i < 8; i++) {
                console.log('---- Channel Data ' + (i + 1) + ': ' + sample.channelData[i]);
            }
            for(var j = 0; j < 3; j++) {
                console.log('---- Aux Data ' + j + ': ' + sample.auxData[j]);
            }
            console.log('---- Stop Byte: ' + sample.stopByte);
        }
    },
    samplePrintHeader: function() {
        return (
            'All voltages in Volts!' +
            'sampleNumber, channel1, channel2, channel3, channel4, channel5, channel6, channel7, channel8, aux1, aux2, aux3\n');
    },
    samplePrintLine: function(sample) {
        return new Promise((resolve, reject) => {
            if (sample === null || sample === undefined) reject('undefined sample');

            resolve(
                sample.sampleNumber + ',' +
                sample.channelData[0].toFixed(8) + ',' +
                sample.channelData[1].toFixed(8) + ',' +
                sample.channelData[2].toFixed(8) + ',' +
                sample.channelData[3].toFixed(8) + ',' +
                sample.channelData[4].toFixed(8) + ',' +
                sample.channelData[5].toFixed(8) + ',' +
                sample.channelData[6].toFixed(8) + ',' +
                sample.channelData[7].toFixed(8) + ',' +
                sample.auxData[0].toFixed(8) + ',' +
                sample.auxData[1].toFixed(8) + ',' +
                sample.auxData[2].toFixed(8) + '\n'
            );
        });
    },
    /**
     * @description Convert float number into three byte buffer. This is the opposite of .interpret24bitAsInt32()
     * @param float - The number you want to convert
     * @returns {Buffer} - 3-byte buffer containing the float
     */
    floatTo3ByteBuffer: function(float) {
        var intBuf = new Buffer(3); // 3 bytes for 24 bits
        intBuf.fill(0); // Fill the buffer with 0s

        var temp = float / ( ADS1299_VREF / 24 / (Math.pow(2,23) - 1)); // Convert to counts

        temp = Math.floor(temp); // Truncate counts number

        // Move into buffer
        intBuf[2] = temp & 255;
        intBuf[1] = (temp & (255 << 8)) >> 8;
        intBuf[0] = (temp & (255 << 16)) >> 16;

        return intBuf;
    },
    /**
     * @description Convert float number into three byte buffer. This is the opposite of .interpret24bitAsInt32()
     * @param float - The number you want to convert
     * @returns {Buffer} - 3-byte buffer containing the float
     */
    floatTo2ByteBuffer: function(float) {
        var intBuf = new Buffer(2); // 2 bytes for 16 bits
        intBuf.fill(0); // Fill the buffer with 0s

        var temp = float / SCALE_FACTOR_ACCEL; // Convert to counts

        temp = Math.floor(temp); // Truncate counts number

        //console.log('Num: ' + temp);

        // Move into buffer
        intBuf[1] = temp & 255;
        intBuf[0] = (temp & (255 << 8)) >> 8;

        return intBuf;
    },
    /**
     * @description Calculate the impedance for one channel only.
     * @param sampleObject - Standard OpenBCI sample object
     * @param channelNumber - Number, the channel you want to calculate impedance for.
     * @returns {Promise} - Fulfilled with impedance value for the specified channel.
     * @author AJ Keller
     */
    impedanceCalculationForChannel: function(sampleObject,channelNumber) {
        const sqrt2 = Math.sqrt(2);
        return new Promise((resolve,reject) => {
            if(sampleObject === undefined || sampleObject === null) reject('Sample Object cannot be null or undefined');
            if(sampleObject.channelData === undefined || sampleObject.channelData === null) reject('Channel cannot be null or undefined');
            if(channelNumber < 1 || channelNumber > k.OBCINumberOfChannelsDefault) reject('Channel number invalid.');

            var index = channelNumber - 1;

            if (sampleObject.channelData[index] < 0) {
                sampleObject.channelData[index] *= -1;
            }
            var impedance = (sqrt2 * sampleObject.channelData[index]) / k.OBCILeadOffDriveInAmps;
            //if (index === 0) console.log("Voltage: " + (sqrt2*sampleObject.channelData[index]) + " leadoff amps: " + k.OBCILeadOffDriveInAmps + " impedance: " + impedance);
            resolve(impedance);
        });
    },
    /**
     * @description Calculate the impedance for all channels.
     * @param sampleObject - Standard OpenBCI sample object
     * @returns {Promise} - Fulfilled with impedances for the sample
     * @author AJ Keller
     */
    impedanceCalculationForAllChannels: function(sampleObject) {
        const sqrt2 = Math.sqrt(2);
        return new Promise((resolve,reject) => {
            if(sampleObject === undefined || sampleObject === null) reject('Sample Object cannot be null or undefined');
            if(sampleObject.channelData === undefined || sampleObject.channelData === null) reject('Channel cannot be null or undefined');

            var sampleImpedances = [];
            var numChannels = sampleObject.channelData.length;
            for (var index = 0;index < numChannels; index++) {
                if (sampleObject.channelData[index] < 0) {
                    sampleObject.channelData[index] *= -1;
                }
                var impedance = (sqrt2 * sampleObject.channelData[index]) / k.OBCILeadOffDriveInAmps;
                sampleImpedances.push(impedance);

                //if (index === 0) console.log("Voltage: " + (sqrt2*sampleObject.channelData[index]) + " leadoff amps: " + k.OBCILeadOffDriveInAmps + " impedance: " + impedance);
            }

            sampleObject.impedances = sampleImpedances;

            resolve(sampleObject);
        });
    },
    interpret16bitAsInt32: function(twoByteBuffer) {
        var prefix = 0;

        if(twoByteBuffer[0] > 127) {
            //console.log('\t\tNegative number');
            prefix = 65535; // 0xFFFF
        }

        return (prefix << 16) | (twoByteBuffer[0] << 8) | twoByteBuffer[1];
    },
    interpret24bitAsInt32: function(threeByteBuffer) {
        var prefix = 0;

        if(threeByteBuffer[0] > 127) {
            //console.log('\t\tNegative number');
            prefix = 255;
        }

        return (prefix << 24 ) | (threeByteBuffer[0] << 16) | (threeByteBuffer[1] << 8) | threeByteBuffer[2];

    },
    impedanceArray: (numberOfChannels) => {
        var impedanceArray = [];
        for (var i = 0; i < numberOfChannels; i++) {
            impedanceArray.push(newImpedanceObject(i+1));
        }
        return impedanceArray;
    },
    impedanceObject: newImpedanceObject,
    impedanceSummarize: (singleInputObject) => {
        if (singleInputObject.raw > k.OBCIImpedanceThresholdBadMax) { // The case for no load (super high impedance)
            singleInputObject.text = k.OBCIImpedanceTextNone;
        } else {
            singleInputObject.text = k.getTextForRawImpedance(singleInputObject.raw); // Get textual impedance
        }
    },
    newSample: function() {
        return {
            startByte: k.OBCIByteStart,
            sampleNumber:0,
            channelData: [],
            auxData: [],
            stopByte: k.OBCIByteStop
        }
    },
    /**
     * @description Create a configurable function to return samples for a simulator. This implements 1/f filtering injection to create more brain like data.
     * @param numberOfChannels
     * @param sampleRateHz
     * @param injectAlpha
     * @param lineNoise
     * @returns {Function}
     */
    randomSample: function(numberOfChannels,sampleRateHz, injectAlpha,lineNoise) {
        var self = this;
        const distribution = gaussian(0,1);
        const sineWaveFreqHz10 = 10;
        const sineWaveFreqHz50 = 50;
        const sineWaveFreqHz60 = 60;
        const uVolts = 1000000;

        var sinePhaseRad = new Array(numberOfChannels+1); //prevent index error with '+1'
        sinePhaseRad.fill(0);

        var auxData = [0,0,0];

        // Init arrays to hold coefficients for each channel
        var b0 = new Array(numberOfChannels);
        var b1 = new Array(numberOfChannels);
        var b2 = new Array(numberOfChannels);

        // Init coefficients to 0
        b0.fill(0);
        b1.fill(0);
        b2.fill(0);

        return function(previousSampleNumber) {
            var newSample = self.newSample();
            var whiteNoise;
            for(var i = 0; i < numberOfChannels; i++) { //channels are 0 indexed
                // This produces white noise
                whiteNoise = distribution.ppf(Math.random()) * Math.sqrt(sampleRateHz/2)/uVolts;

                switch (i) {
                    case 0: // Add 10Hz signal to channel 1... briany
                    case 1:
                        if (injectAlpha) {
                            sinePhaseRad[i] += 2 * Math.PI * sineWaveFreqHz10 / sampleRateHz;
                            if (sinePhaseRad[i] > 2 * Math.PI) {
                                sinePhaseRad[i] -= 2 * Math.PI;
                            }
                            whiteNoise += (5 * Math.SQRT2 * Math.sin(sinePhaseRad[i]))/uVolts;
                        }
                        break;
                    default:
                        if (lineNoise === k.OBCISimulatorLineNoiseHz60) {
                            // If we're in murica we want to add 60Hz line noise
                            sinePhaseRad[i] += 2 * Math.PI * sineWaveFreqHz60 / sampleRateHz;
                            if (sinePhaseRad[i] > 2 * Math.PI) {
                                sinePhaseRad[i] -= 2 * Math.PI;
                            }
                            whiteNoise += (8 * Math.SQRT2 * Math.sin(sinePhaseRad[i])) / uVolts;
                        } else if (lineNoise === k.OBCISimulatorLineNoiseHz50){
                            // add 50Hz line noise if we are not in america
                            sinePhaseRad[i] += 2 * Math.PI * sineWaveFreqHz50 / sampleRateHz;
                            if (sinePhaseRad[i] > 2 * Math.PI) {
                                sinePhaseRad[i] -= 2 * Math.PI;
                            }
                            whiteNoise += (8 * Math.SQRT2 * Math.sin(sinePhaseRad[i])) / uVolts;
                        }
                }
                /**
                 * See http://www.firstpr.com.au/dsp/pink-noise/ section "Filtering white noise to make it pink"
                 */
                b0[i] = 0.99765 * b0[i] + whiteNoise * 0.0990460;
                b1[i] = 0.96300 * b1[i] + whiteNoise * 0.2965164;
                b2[i] = 0.57000 * b2[i] + whiteNoise * 1.0526913;
                newSample.channelData[i] = b0[i] + b1[i] + b2[i] + whiteNoise * 0.1848;
            }
            if (previousSampleNumber == 255) {
                newSample.sampleNumber = 0;
            } else {
                newSample.sampleNumber = previousSampleNumber + 1;
            }
            newSample.auxData = auxData;

            return newSample;
        };
    },
    scaleFactorAux: SCALE_FACTOR_ACCEL,
    k:k,
    /**
     * @description Use the Goertzel algorithm to calculate impedances
     * @param sample - a sample with channelData Array
     * @param goertzelObj - An object that was created by a call to this.goertzelNewObject()
     * @returns {Array} - Returns an array if finished computing
     */
    goertzelProcessSample: (sample,goertzelObj) => {
        // calculate the goertzel values for all channels
        for (var i = 0; i < goertzelObj.numberOfChannels; i++) {
            var q0 = GOERTZEL_COEFF_250 * goertzelObj.q1[i] - goertzelObj.q2[i] + sample.channelData[i];
            goertzelObj.q2[i] = goertzelObj.q1[i];
            goertzelObj.q1[i] = q0;

            //console.log('Q1: ' + goertzelObj.q1[i] + ' Q2: ' + goertzelObj.q2[i]);
        }


        // Increment the index counter
        goertzelObj.index++;


        // Have we iterated more times then block size?
        if (goertzelObj.index > GOERTZEL_BLOCK_SIZE) {
            var impedanceArray = [];
            for (var j = 0; j < goertzelObj.numberOfChannels; j++) {
                // Calculate the magnitude of the voltage
                var q1SQRD = goertzelObj.q1[j] * goertzelObj.q1[j];
                var q2SQRD = goertzelObj.q2[j] * goertzelObj.q2[j];
                var lastPart = goertzelObj.q1[j] * goertzelObj.q2[j] * GOERTZEL_COEFF_250;

                //console.log('Chan ' + j + ', Q1^2: ' + q1SQRD + ', Q2^2: ' + q2SQRD + ', Last Part: ' + lastPart);

                var voltage = Math.sqrt((goertzelObj.q1[j] * goertzelObj.q1[j]) + (goertzelObj.q2[j] * goertzelObj.q2[j]) - goertzelObj.q1[j] * goertzelObj.q2[j] * GOERTZEL_COEFF_250);

                // Calculate the impedance r = v/i
                var impedance = voltage / k.OBCILeadOffDriveInAmps;
                // Push the impedance into the final array
                impedanceArray.push(impedance);

                // Reset the goertzel variables to get ready for the next iteration
                goertzelObj.q1[j] = 0;
                goertzelObj.q2[j] = 0;
            }

            // Reset the goertzel index counter
            goertzelObj.index = 0;

            // Pass out the impedance array
            return impedanceArray;
        } else {
            // This reject is really just for debugging
            return;
        }
    },
    goertzelNewObject: (numberOfChannels) => {
        // Object to help calculate the goertzel
        var q1 = [];
        var q2 = [];
        for (var i = 0; i < numberOfChannels; i++) {
            q1.push(0);
            q2.push(0);
        }
        return {
            q1: q1,
            q2: q2,
            index: 0,
            numberOfChannels: numberOfChannels
        }
    },
    GOERTZEL_BLOCK_SIZE:GOERTZEL_BLOCK_SIZE
};

module.exports = sampleModule;

function newImpedanceObject(channelNumber) {
    return {
        channel: channelNumber,
        P: {
            raw: -1,
            text: k.OBCIImpedanceTextInit
        },
        N: {
            raw: -1,
            text: k.OBCIImpedanceTextInit
        }
    }
}

/**
 * @description This method parses a 33 byte OpenBCI V3 packet and converts to a sample object
 * @param dataBuf - 33 byte packet that has bytes:
 * 0:[startByte] | 1:[sampleNumber] | 2:[Channel-1.1] | 3:[Channel-1.2] | 4:[Channel-1.3] | 5:[Channel-2.1] | 6:[Channel-2.2] | 7:[Channel-2.3] | 8:[Channel-3.1] | 9:[Channel-3.2] | 10:[Channel-3.3] | 11:[Channel-4.1] | 12:[Channel-4.2] | 13:[Channel-4.3] | 14:[Channel-5.1] | 15:[Channel-5.2] | 16:[Channel-5.3] | 17:[Channel-6.1] | 18:[Channel-6.2] | 19:[Channel-6.3] | 20:[Channel-7.1] | 21:[Channel-7.2] | 22:[Channel-7.3] | 23:[Channel-8.1] | 24:[Channel-8.2] | 25:[Channel-8.3] | 26:[Aux-1.1] | 27:[Aux-1.2] | 28:[Aux-2.1] | 29:[Aux-2.2] | 30:[Aux-3.1] | 31:[Aux-3.2] | 32:StopByte
 * @param channelSettingsArray - An array of channel settings that is an Array that has shape similar to the one
 *                  calling OpenBCIConstans.channelSettingsArrayInit(). The most important rule here is that it is
 *                  Array of objects that have key-value pair {gain:NUMBER}
 * @returns {Promise} - Fulfilled with a sample object that has form:
 *                  {
     *                      channelData: Array of floats
     *                      auxData: Array of floats of accel data
     *                      sampleNumber: a Number that is the sample
     *                  }
 */
function parsePacketStandard(dataBuf, channelSettingsArray) {
    return new Promise((resolve, reject) => {
        if (dataBuf.byteLength != k.OBCIPacketSize) reject("Error [parsePacketStandard]: input buffer must be " + k.OBCIPacketSize + " bytes!");

        var sampleObject = {};
        // Need build the standard sample object
        getAccelDataArray(dataBuf.slice(k.OBCIPacketPositionStartAux,k.OBCIPacketPositionStopAux+1))
            .then(accelData => {
                sampleObject.auxData = accelData;
                return getChannelDataArray(dataBuf.slice(k.OBCIPacketPositionChannelDataStart,k.OBCIPacketPositionChannelDataStop+1), channelSettingsArray);
            })
            .then(channelSettingArray => {
                sampleObject.channelData = channelSettingArray;
                // Get the sample number
                sampleObject.sampleNumber = dataBuf[k.OBCIPacketPositionSampleNumber];
                // Get the start byte
                sampleObject.startByte = dataBuf[0];
                // Get the stop byte
                sampleObject.stopByte = dataBuf[k.OBCIPacketPositionStopByte];
                resolve(sampleObject);
            })
            .catch(err => {
                console.log(err);
                //reject(err);
            });

    });
}
/**
 * @description Takes a buffer filled with 3 16 bit integers from an OpenBCI device and converts based on settings
 *                  of the MPU, values are in ?
 * @param dataBuf - Buffer that is 6 bytes long
 * @returns {Promise} - Fulfilled with Array of floats 3 elements long
 * @author AJ Keller (@pushtheworldllc)
 */
function getAccelDataArray(dataBuf) {
    return new Promise(resolve => {
        var accelData = [];
        for (var i = 0; i < ACCEL_NUMBER_AXIS; i++) {
            var index = i * 2;
            accelData.push(sampleModule.interpret16bitAsInt32(dataBuf.slice(index, index + 2)) * SCALE_FACTOR_ACCEL);
        }
        resolve(accelData);
    });
}
/**
 * @description Takes a buffer filled with 24 bit signed integers from an OpenBCI device with gain settings in
 *                  channelSettingsArray[index].gain and converts based on settings of ADS1299... spits out an
 *                  array of floats in VOLTS
 * @param dataBuf - Buffer with 24 bit signed integers, number of elements is same as channelSettingsArray.length * 3
 * @param channelSettingsArray - The channel settings array, see OpenBCIConstants.channelSettingsArrayInit() for specs
 * @returns {Promise} - Fulfilled with Array filled with floats for each channel's voltage in VOLTS
 * @author AJ Keller (@pushtheworldllc)
 */
function getChannelDataArray(dataBuf, channelSettingsArray) {
    return new Promise((resolve, reject) => {
        if (!Array.isArray(channelSettingsArray)) reject('Error [getChannelDataArray]: Channel Settings must be an array!');
        var channelData = [];
        // Iterate through each object in the array
        channelSettingsArray.forEach((channelSettingsObject, index) => {
            if (!channelSettingsObject.hasOwnProperty('gain')) reject('Error [getChannelDataArray]: Invalid channel settings object at index ' + index);
            if (!k.isNumber(channelSettingsObject.gain)) reject('Error [getChannelDataArray]: Property gain of channelSettingsObject not or type Number');
            // Get scale factor
            var scaleFactor = ADS1299_VREF / channelSettingsObject.gain / (Math.pow(2,23) - 1);
            // Each number is 3 bytes, need to traverse index * 3 in the buffer
            index *= 3;
            // Convert the three byte signed integer and convert it
            channelData.push(scaleFactor * sampleModule.interpret24bitAsInt32(dataBuf.slice(index, index + 3)));
        });
        resolve(channelData);
    });
}
function getRawPacketType(stopByte) {
    return stopByte & 0xF;
}
