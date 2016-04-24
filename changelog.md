# 0.3.2

### Work In Progress

* SNTP Time Synchronization

### Bug Fixes

* updates to README.me and comments to change ntp to sntp, because the two are similar, but not the same and we do not want to be misleading
* Extended [Stnp](https://www.npmjs.com/package/sntp) to main openBCIBoard.js
* Add `.sntpNow()` function to get ntp time.

# 0.3.1

### Bug Fixes

* Bumped serialport version

# 0.3.0

### New Features

* Test Signals with ADS1299 using `.testSignal()`
* Continuous impedance testing, where each sample gets an `impedances` object that is an array of impedances for each
        channel.
* OpenBCI Radio Test File
* Added Sntp npm module with helper functions
* Removed stopByte and startByte from sampleObjects
    
### Breaking Changes

* Changed simulator name to `OpenBCISimulator`
* Changed name of function `simulatorOn` to `simulatorEnable`
* Changed name of function `simulatorOff` to `simulatorDisable`

### Work In Progress

* NTP Time Synchronization
* Goertzel algorithm to get voltage for impedance calculation
    
### Bug fixes

* Impedance calculations
* Readme updates
* Serial buffer had the chance to become permanently unaligned, optimized and completely transformed and refactored the way bytes are processed.
* Changes to gain of channels not working correctly.
* Node 5 compatibility 
    
### Github Issues Addressed

* #25, #26, #27, #29, #30, #31, #33, #34