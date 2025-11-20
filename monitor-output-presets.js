/********************************************************
Copyright (c) 2025 Cisco and/or its affiliates.
This software is licensed to you under the terms of the Cisco Sample
Code License, Version 1.1 (the "License"). You may obtain a copy of the
License at
               https://developer.cisco.com/docs/licenses
All use of the material herein must be in accordance with the terms of
the License. All rights not expressly granted by the License are
reserved. Unless required by applicable law or agreed to separately in
writing, software distributed under the License is distributed on an "AS
IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
or implied.
*********************************************************

 * Author(s):               Robert(Bobby) McGonigle Jr
 *                          Technical Marketing Engineering, Technical Leader
 *                          Cisco Systems
 * 
 * Consulting Engineer(s):  Mike Nelson
 *                          Solutions Engineer
 *                          Cisco Systems
 * 
 * Date: October 25, 2025
 * Last Updated: November 20, 2025
 * Version: 0.9.1
 * 
 * Description
 *     - Spawns an Interface that allows a user to create Monitor Presets (Display Output)
 *        - Offers changes of Monitor Role per Screen
 *        - Offers Matrix Routing of Video Input Connectors per Screen
 *        - Allows the user to save this preset into non-volatile memory to recover on the fly
 * 
 * MTR Compatible: No
 *                 MTR does not support Monitor Roles in Full.
 *                 MTR Does NOT support Video Matrix APIs.
 * 
 * - 0.9.1 Release Note
 *  - Bug Fixes, New final candidate
 * 
 * - 0.9.0 Release Note
 *  - Final Candidate
 *  - What's Working
 *   - All Known Features
 * 
 *  - What's Left
 *   - RoomOS 11 Devices Testing
 *   - Devices Pre-Peripheral ID Testing
 *   - More precise and clear logging
 *   - Harden Solution to Minimum RoomOS Version
 *   - Block MTR use as it's incompatible
 * 
 * - 0.5.0 Release Notes
 *  - What's Working
 *    - Monitor Presets Panel
 *      - Generate Panel based on Stored Presets
 *      - Activating Presets
 *      - Renaming Presets
 *      - Setting Preset as Default (Visual Update only)
 *    - Monitor Preset Maker Panel
 *      - Generate Panel based on Available Outputs and Inputs
 *      - Changing Monitor Role Values
 *      - Routing Inputs to Outputs
 *      - Saving Presets
 * 
 *  - In Progress
 *    - Monitor Presets Panel
 *      - Deleting Presets
 *      - Enforce Default Preset based on Call and Standby States
 *    - Monitor Preset Maker Panel
 *      - Entire Config Page
 *      - Preset Recovery
*/

import xapi from 'xapi';

/** Developer Configurations options
 * 
 * Best not to alter unless doing active development against this solution
 * 
 */
const developer = {
  ftsDefaults: {
    PinProtection: {
      Mode: 'Enabled',
      Pin: '000000'
    },
    InitialOutputName: 'HDMI',
  },
  PinProtection: {
    Regex: /^\d{4,8}$/
  },
  Preset: {
    DefaultTerminator: '✪',
    ShowIndex: false,
    OptionsTimeout: 3,
    NameRegex: /^[\x20-\x7E]{1,20}$/
  }
}

/**Version of the Macro */
const version = '0.9.1';

/**Name of the Macro. If running on older RoomOS software, this may error (OS9, OS10)*/
const thisMacro = _main_macro_name();

/**Name for Storage Macro, Uses this Macro name plus -Storage*/
const storageMacroName = `${thisMacro}-Storage`;

/** Defines the Pin Code Warning when using a Default Pin */
const defaultPinWarning = `Your using the Macro Default Pin > ${developer.ftsDefaults.PinProtection.Pin}. Please change this pin to better protect this tool`;

/**This governs the order in which available Monitor Role configs per display will render */
const monitorRoleOrderTemplate = ['Auto', 'First', 'Second', 'Third', 'PresentationOnly', 'Recorder'];

/**This governs the order in which available Video Monitor configs will render */
const videoMonitorsOrderTemplate = ['Auto', 'Single', 'Dual', 'DualPresentationOnly', 'Triple', 'TriplePresentationOnly'];

/** The currently selected video output in the Monitor Preset Maker */
let selectedMakerOutput = 1;

let selectedMakerInput = null;

const dev = {
  SubOptionsReleaseHandler: false // If true, will prevent the preset from executing on release when sub options menu pops up
}

let currentMatrixRoute = []

Object.prototype.clone = Array.prototype.clone = function () {
  if (Object.prototype.toString.call(this) === '[object Array]') {
    const clone = [];
    for (let i = 0; i < this.length; i++) {
      clone[i] = this[i].clone();
    };
    return clone;
  } else if (typeof (this) == "object") {
    const clone = {};
    for (let prop in this) {
      if (this.hasOwnProperty(prop)) {
        clone[prop] = this[prop].clone();
      };
    };
    return clone;
  } else {
    return this;
  };
};

Array.prototype.orderByTemplate = function (templateArr) {
  const known = this.filter(item => templateArr.includes(item))
    .sort((a, b) => templateArr.indexOf(a) - templateArr.indexOf(b));
  const unknown = this.filter(item => !templateArr.includes(item));
  return [...known, ...unknown];
};

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

function check3colGroupButtonTextSize(textToCheck) {
  // The maximum calculated 'score' the text can have before it is considered too wide.
  // This value is based on the limit of 8 wide characters (8 * 1.0 = 8.0).
  const MAX_EFFECTIVE_WIDTH = 8.0;

  if (!textToCheck) {
    return true;
  }

  /**
   * Internal helper to determine the proportional weight of a character.
   * Weights are calibrated relative to the maximum width score of 8.0:
   * - Heavy (1.0): W, M, @ (8 fit)
   * - Standard (0.75): A-Z, 0-9 (approx. 11 fit)
   * - Light (0.30): i, l, . (approx. 26 fit)
   *
   * @param {string} char - Single character to weigh.
   * @returns {number} - The effective width score (0.3, 0.75, or 1.0).
   */
  const getEffectiveCharacterWeight = (char) => {
    // 1. Heavy Characters (Weight 1.0): W, M, and wide symbols (8 fit)
    if (/[MW@#$%&\*(){}\[\]]/.test(char)) {
      return 1.0;
    }

    // 2. Light/Narrow Characters (Weight 0.3): i, l, ., space, etc. (approx 26 fit)
    // Note: Space (\s) is explicitly included here as it is often a narrow character.
    if (/[iltfj\.,:;'`!\s-]/.test(char)) {
      return 0.3;
    }

    // 3. Standard/Medium Characters (Weight 0.75): All other letters and numbers (approx 11 fit)
    return 0.75;
  };

  let effectiveWidth = 0;

  for (const char of textToCheck) {
    effectiveWidth += getEffectiveCharacterWeight(char);
  }

  // Optimization: Exit early if the limit is exceeded
  if (effectiveWidth > MAX_EFFECTIVE_WIDTH) {
    console.warn(`Character weight for ${textToCheck} greater than maximum [${effectiveWidth} > ${MAX_EFFECTIVE_WIDTH}]`)
    return {
      state: false,
      weight: effectiveWidth
    };
  }

  // If the loop completes, the effective width is acceptable
  return {
    state: true,
    weight: effectiveWidth
  };
}

//Runs Subscriptions found in Subscribe Object
async function StartSubscriptions() {
  const subs = Object.getOwnPropertyNames(Subscribe);
  subs.sort();
  let mySubscriptions = [];
  subs.forEach(element => {
    Subscribe[element]();
    mySubscriptions.push(element);
    Subscribe[element] = function () {
      console.warn({ Warn: `The [${element}] subscription is already active, unable to fire it again` });
    };
  });
  console.log({ Message: 'Subscriptions Set', Details: { Total_Subs: subs.length, Active_Subs: mySubscriptions.join(', ') } });
};

async function openDopmHidden({ Origin: Target, PeripheralId }) {
  await xapi.Command.UserInterface.Extensions.Panel.Open({ PanelId: 'dopm_hidden', PeripheralId });
  await xapi.Command.UserInterface.Extensions.Widget.Action({ WidgetId: 'dopm~Maker~OutputSelect', Type: 'released', Value: 1 })
  await updateMonitorRole({ UpdateFeedback: true });
  await updateVideoMonitor({ UpdateFeedback: true });
  await updatePinFeedback();
}

function getMatrixOrderByOutputId(connectorId) {
  const output = currentMatrixRoute.find(item => item.Connector === parseInt(connectorId));
  return output;
}

async function addSourceToMatrix(connectorId, valueToAdd) {
  const output = currentMatrixRoute.find(item => item.Connector === parseInt(connectorId));
  if (output) {
    output.InputOrder.push(valueToAdd);
    for (const [index, input] of output.InputOrder.entries()) {
      let matrixAction = (index == 0 ? 'Replace' : 'Add')
      try {
        await xapi.Command.Video.Matrix.Assign({ Output: output.Connector, SourceId: input, Mode: matrixAction, Layout: output.Layout })
        console.debug(`Matrix Route on Output [${output.Connector}] Set || Input: [${input}] || Action: ${matrixAction} || Index: [${index}] || Layout: [${output.Layout}]`)
      } catch (e) {
        const err = { Context: `Failed to matrix route input source [${input}] to output [${output.Connector}]. Action: ${matrixAction} || Layout: [${output.Layout}]`, Func: thisFunc, Error: e };
        console.error(err)
      }
    }
    await xapi.Command.UserInterface.Extensions.Widget.SetValue({ WidgetId: 'dopm~Maker~Matrix:RouteOrder', Value: `Route Order: [${output.InputOrder.join(', ')}]` })
    return
  }
  console.warn(`Connector with ID ${connectorId} not found.`);
  return
}

async function clearMatrix(connectorId) {
  const output = currentMatrixRoute.find(item => item.Connector === connectorId);
  if (output) {
    output.InputOrder = [];
    await xapi.Command.Video.Matrix.Reset({ Output: output.Connector })
    await xapi.Command.UserInterface.Extensions.Widget.SetValue({ WidgetId: 'dopm~Maker~Matrix:RouteOrder', Value: `Route Order: [${output.InputOrder.join(', ')}]` })
    return;
  }
  console.warn(`Connector with ID ${connectorId} not found.`);
  return;
}

const Subscribe = {
  PanelClicked: function () {
    xapi.Event.UserInterface.Extensions.Panel.Clicked.on(handle.PanelClicked)
  },
  WidgetAction: function () {
    xapi.Event.UserInterface.Extensions.Widget.Action.on(handle.WidgetAction)
  },
  TextInputResponse: function () {
    xapi.Event.UserInterface.Message.TextInput.Response.on(handle.TextInputResponse)
  },
  PromptResponse: function () {
    xapi.Event.UserInterface.Message.Prompt.Response.on(handle.PromptResponse);
  },
  StandbyState: function () {
    xapi.Status.Standby.State.on(handle.StandbyState);
  },
  CallDisconnect: function () {
    xapi.Event.CallDisconnect.on(handle.CallDisconnect);
  }
}

async function showPinEntry(options) {
  let msg = {
    Title: 'Monitor Preset Maker Pin',
    Text: 'Enter your pin below to access the Monitor Preset Maker',
    Placeholder: '4-8 Digit Numeric Pin Accepted'
  }

  msg.Duration = 60;
  msg.FeedbackId = options.FeedbackId;
  msg.InputType = 'PIN';
  msg.SubmitText = 'Unlock';

  if (options.FeedbackId.includes('dop_pinEntry_ConfirmDelete')) {
    msg.Title = `Are you sure?`
    msg.Text = `Enter the Monitor Preset Maker pin to confirm deletion of<p>Preset: ${DisplaySystemConfig.Preset.List[options.PresetIndex].Name}`;
    msg.SubmitText = 'Delete ⚠️';
  }

  if (options.isError) {
    msg.Title = `⚠️ ${msg.Title} ⚠️`
    msg.Text = `⚠️ Invalid Pin, Try Again ⚠️<p>${msg.Text}`;
  }

  if (options.PeripheralId) {
    msg.PeripheralId = options.PeripheralId
  }
  await xapi.Command.UserInterface.Message.TextInput.Display(msg);
}

async function showNoPinRemovePrompt(options) {
  let msg = {
    Title: `Are you sure?`,
    Text: `Enter the Monitor Preset Maker pin to confirm deletion of<p>Preset: ${DisplaySystemConfig.Preset.List[options.PresetIndex].Name}`,
    Duration: 60,
    FeedbackId: `dop_Prompt_ConfirmDelete~Index:${options.PresetIndex}`,
    "Option.1": 'Delete ⚠️',
    "Option.2": 'Dismiss'
  }

  if (options.PeripheralId) {
    msg.PeripheralId = options.PeripheralId
  }

  await xapi.Command.UserInterface.Message.Prompt.Display(msg);
}

async function showPinEdit(options) {
  let msg = {
    Title: 'Monitor Preset Pin Edit',
    Text: 'Enter your current pin to confirm access',
    Placeholder: '4-8 Digit Numeric Pin Accepted'
  }

  msg.Duration = 60;
  msg.FeedbackId = options.FeedbackId;
  msg.InputType = 'PIN';
  msg.SubmitText = 'Next';

  if (options.isError) {
    msg.Title = `⚠️ ${msg.Title} ⚠️`
    msg.Text = `⚠️ Invalid Pin, Try Again ⚠️<p>${msg.Text}`;
    await xapi.Command.UserInterface.Message.TextInput.Display(msg);
    return;
  }

  if (options.FeedbackId.includes('dopm_pinEdit_NewPin')) {
    msg.Title = `Monitor Preset New Pin`
    msg.Text = `Enter a NEW 4-8 Digit Numeric Pin for the Monitor Preset Maker`;
    msg.SubmitText = 'Next';
  }

  if (options.FeedbackId.includes('dopm_pinEdit_ConfirmNewPin')) {
    msg.Title = `Monitor Preset Confirm Pin`
    msg.Text = `Conform your NEW 4-8 Digit Numeric Pin for the Monitor Preset Maker`;
    msg.SubmitText = 'Save';
  }

  if (options.PeripheralId) {
    msg.PeripheralId = options.PeripheralId
  }

  await xapi.Command.UserInterface.Message.TextInput.Display(msg);
}

function showMonitorRenamePrompt(options) {
  let msg = {
    Title: 'Edit HDMI Output Name',
    Text: `Helps identify which display you're working with in Monitor Preset Maker (Weight < 8.0)`,
    Placeholder: `Enter Monitor Name Here (Weight < 8.0)`,
    SubmitText: 'Update',
    InputText: DisplaySystemConfig.OutputNames[options.Connector],
    FeedbackId: `dopm_outputName~ConnecotrId:${options.Connector}`
  }

  if (options.isError) {
    msg.Text = `⚠️ Name too large. Weight: ${options.Weight}<p>${msg.Text}`
    msg.InputText = options.RedoName
  }

  if (options.PeripheralId) {
    msg.PeripheralId = options.PeripheralId
  }
  xapi.Command.UserInterface.Message.TextInput.Display(msg);
}

let tempNewPin = '';

const handle = {
  PanelClicked: async function ({ PanelId, Origin, PeripheralId }) {
    let options = {}
    if (Origin && PeripheralId) { options = { Origin, PeripheralId, FeedbackId: `dop_pinEntry_MakerAccess` } }; // Introduced much later in RoomOS, but useful once up to date
    switch (PanelId) {
      case 'dopm_visible':

        if (DisplaySystemConfig.PinProtection.Mode == 'Enabled') {
          await showPinEntry(options);
        } else {
          await openDopmHidden(options)
        }
        break;
      case 'dop':
        break;
    }
  },
  WidgetAction: async function ({ WidgetId, Type, Value, Origin, PeripheralId }) {
    if (Type == 'clicked') return;

    let options = {};
    if (Origin && PeripheralId) { options = { Origin, PeripheralId }; }

    if (WidgetId.includes('dop') || WidgetId.includes('dopm')) {
      let [panel, page, action, data] = WidgetId.split(`~`);
      let subAction;
      if (action.includes(':')) {
        subAction = action.split(':')[1];
        action = action.split(':')[0];
      }

      const currentHandlers = (Type === 'released') ? handle.ReleasedWidgets : handle.PressedWidgets;
      if (!currentHandlers) return;

      const pageHandlers = currentHandlers[page];
      if (!pageHandlers) return;

      let actionHandler = pageHandlers[action];

      // Prepare the parameters as a single object
      const handlerParams = {
        subAction,
        data,
        Value,
        options,
        WidgetId,
        Type,
        Origin,
        PeripheralId
      };

      if (actionHandler && typeof actionHandler === 'object' && subAction) {
        const subActionHandler = actionHandler[subAction] || actionHandler['_default_'];
        if (subActionHandler) {
          subActionHandler(handlerParams)
        }
      } else if (typeof actionHandler === 'function') {
        actionHandler(handlerParams);
      }
    }
  },
  TextInputResponse: async function ({ FeedbackId, Text, Origin, PeripheralId }) {

    if (FeedbackId.includes('dopm_renamePreset')) {
      const [, PresetIndex] = FeedbackId.split(':');

      if (DisplaySystemConfig.Preset.List[PresetIndex].Name == Text) {
        console.debug(`New Preset name matches existing, no need to update, returning`);
        return
      }

      const testNewName = developer.Preset.NameRegex.test(Text);

      async function showNewNameNameError(cause) {
        console.debug({ Message: 'Rename Monitor Preset Error', Cause: cause });
        await preset.promptSave({ isError: true, PeripheralId });
        return;
      }

      if (!testNewName) {
        showNewNameNameError(`Preset Name Failed Regex Check. Submitted: ${Text}`);
        return;
      }

      await preset.rename(PresetIndex, Text);
    }

    if (FeedbackId.includes('dop_pinEntry_ConfirmDelete')) {
      const [, PresetIndex] = FeedbackId.split(':');
      const testRemovePin = developer.PinProtection.Regex.test(Text)

      async function showPinError(cause) {
        console.debug({ Message: 'Pin Entry Error', Cause: cause });
        await showPinEntry({ isError: true, FeedbackId: `dop_pinEntry_MakerAccess`, ...PeripheralId });
        return;
      }

      if (!testRemovePin) {
        showPinError(`Pin Entry Failed Regex Check. Submitted: ${Text}`);
        return;
      };

      let removePinMatch = Text == DisplaySystemConfig.PinProtection.Pin

      if (!removePinMatch) {
        showPinError(`Pin Entry Mismatch Check. Submitted: ${Text}`);
        return;
      }

      if (removePinMatch && testRemovePin) {
        await preset.remove(PresetIndex)
      } else {
        showPinError(`Unknown Error. Submitted: ${Text}`);
        return;
      }
    }

    if (FeedbackId.includes(`dopm_outputName`)) {
      const [, OutputConnector] = FeedbackId.split(':');

      const checkNameLength = check3colGroupButtonTextSize(Text);

      if (!checkNameLength.state) {
        showMonitorRenamePrompt({ Connector: OutputConnector, PeripheralId, RedoName: Text, isError: true, Weight: checkNameLength.weight });
        return;
      }

      DisplaySystemConfig.OutputNames[OutputConnector] = Text;

      await saveDisplaySystemConfig();

      await buildUI.PresetMaker();

    }

    switch (FeedbackId) {
      case 'dop_pinEntry_MakerAccess':
        const testMakerPin = developer.PinProtection.Regex.test(Text)

        async function showPinError(cause) {
          console.debug({ Message: 'Pin Entry Error', Cause: cause });
          await showPinEntry({ isError: true, FeedbackId: `dop_pinEntry_MakerAccess`, ...PeripheralId });
          return;
        }

        if (!testMakerPin) {
          showPinError(`Pin Entry Failed Regex Check. Submitted: ${Text}`);
          return;
        };

        let makerPinMatch = Text == DisplaySystemConfig.PinProtection.Pin

        if (!makerPinMatch) {
          makerPinMatch(`Pin Entry Mismatch Check. Submitted: ${Text}`);
          return;
        }

        if (makerPinMatch && testMakerPin) {
          await openDopmHidden({ Origin, PeripheralId })
        } else {
          makerPinMatch(`Unknown Error. Submitted: ${Text}`);
          return;
        }
        break;
      case 'dopm_savePreset':
        const testName = developer.Preset.NameRegex.test(Text);

        async function showNameError(cause) {
          console.debug({ Message: 'New Monitor Preset Error', Cause: cause });
          await preset.promptSave({ isError: true, PeripheralId });
          return;
        }

        if (!testName) {
          showNameError(`Preset Name Failed Regex Check. Submitted: ${Text}`);
          return;
        }

        await preset.save(Text);
        break;
      case 'dopm_pinEdit_Validate':
        const validateMakerPin = developer.PinProtection.Regex.test(Text);

        if (!validateMakerPin) {
          showPinEdit({ isError: true, PeripheralId });
          return;
        }

        await showPinEdit({ FeedbackId: 'dopm_pinEdit_NewPin' })
        break;
      case 'dopm_pinEdit_NewPin':
        const checkNewPin = developer.PinProtection.Regex.test(Text);

        if (!checkNewPin) {
          showPinEdit({ isError: true, PeripheralId });
          return;
        }

        tempNewPin = Text;

        await showPinEdit({ FeedbackId: 'dopm_pinEdit_ConfirmNewPin' })
        break;
      case 'dopm_pinEdit_ConfirmNewPin':
        const confirmNewPin = (tempNewPin == Text);

        if (!confirmNewPin) {
          showPinEdit({ isError: true, PeripheralId });
          return;
        }

        DisplaySystemConfig.PinProtection.Pin = Text;

        await saveDisplaySystemConfig();

        xapi.Command.UserInterface.Message.Prompt.Display({
          Title: 'New Pin Saved!',
          Text: '',
          "Option.1": 'Dismiss'
        })

        break;
    }
  },
  PromptResponse: async function ({ FeedbackId, OptionId, Origin, PeripheralId }) {
    if (FeedbackId.includes(`dop_presetOptions~`)) {
      let [, index, isDefault] = FeedbackId.split('~');

      isDefault = isDefault.split(':')[1].toString() == 'true';
      index = parseInt(index.split(':')[1]);

      switch (parseInt(OptionId)) {
        case 1: // Rename Preset
          preset.promptRename({ PresetIndex: index, PeripheralId })
          break;
        case 2: // Set/Remove Preset as Default
          if (isDefault) {
            preset.setDefault(index, true)
          } else {
            preset.setDefault(index)
          }
          break;
        case 3: // Delete Preset
          preset.promptRemoveConfirmation({ PresetIndex: index, PeripheralId, FeedbackId: `dop_pinEntry_ConfirmDelete~Index:${index}` })
          break;
      }
    }

    if (FeedbackId.includes(`dop_Prompt_ConfirmDelete`) && OptionId == 1) {
      const [, PresetIndex] = FeedbackId.split(':');
      await preset.remove(PresetIndex);
    }
  },
  StandbyState: async function (State) {
    if (State == 'Off' && DisplaySystemConfig.Preset.Default !== null) {
      preset.activate(DisplaySystemConfig.Preset.Default);
      console.log(`System exited standby, setting default Monitor Preset. Index: [${DisplaySystemConfig.Preset.Default}] || Name: [${DisplaySystemConfig.Preset.List[DisplaySystemConfig.Preset.Default]}]`)
    }
  },
  CallDisconnect: async function (state) {
    // Ensure the call that disconnected was the ONLY active call. If on a call, and declining another, this fires again
    // Checking the activeCallCount prevents a false positve
    const activeCallCount = await xapi.Status.SystemUnit.State.NumberOfActiveCalls.get()
    if (DisplaySystemConfig.Preset.Default !== null && parseInt(activeCallCount) < 1) {
      preset.activate(DisplaySystemConfig.Preset.Default);
      console.log(`Call Disconnected, setting default Monitor Preset. Index: [${DisplaySystemConfig.Preset.Default}] || Name: [${DisplaySystemConfig.Preset.List[DisplaySystemConfig.Preset.Default]}]`)
    }
  }
}

async function saveDisplaySystemConfig() {
  await mem.write('DisplaySystemConfig', DisplaySystemConfig);
}

const preset = {
  save: async function (name) {
    let presetName = `Monitor Preset ${DisplaySystemConfig.Preset.List.length + 1}`;
    if (name) {
      presetName = name
    }

    let thisNewPreset = {
      Name: presetName,
      MonitorRoles: [],
      Routes: currentMatrixRoute.clone()
    }

    const videoOutputConnectors = await xapi.Config.Video.Output.Connector.get();

    videoOutputConnectors.forEach(output => {
      thisNewPreset.MonitorRoles.push({ Connector: output.id, Role: output.MonitorRole });
    })

    DisplaySystemConfig.Preset.List.push(thisNewPreset);

    DisplaySystemConfig.Preset.Current = (DisplaySystemConfig.Preset.List.length - 1);

    await buildUI.PresetList();

    await saveDisplaySystemConfig();
  },
  promptSave: async function (options) {
    let msg = {
      Title: 'Save Monitor Preset',
      Text: 'Enter a name for your new Monitor Preset',
      Placeholder: '1-20 Alphanumeric Names Accepted'
    }

    if (options.isError) {
      msg.Text += `⚠️ Limited to 1-20 Alphanumeric Characters ⚠️<p>${msg.Text}`
    }

    msg.Duration = 120;
    msg.FeedbackId = `dopm_savePreset`;
    msg.SubmitText = 'Save';
    if (options.PeripheralId) {
      msg.PeripheralId = options.PeripheralId
    }
    await xapi.Command.UserInterface.Message.TextInput.Display(msg);
  },
  promptRename: async function (options) {
    let msg = {
      Title: 'Rename Monitor Preset',
      Text: `Enter a new name for Monitor Preset<p>${DisplaySystemConfig.Preset.List[options.PresetIndex].Name}`,
      Placeholder: '1-20 Alphanumeric Names Accepted',
      InputText: DisplaySystemConfig.Preset.List[options.PresetIndex].Name
    }

    if (options.isError) {
      msg.Text += `⚠️ Limited to 1-20 Alphanumeric Characters ⚠️<p>${msg.Text}`
    }

    msg.Duration = 120;
    msg.FeedbackId = `dopm_renamePreset~Index:${options.PresetIndex}`;
    msg.SubmitText = 'Update';

    if (options.PeripheralId) {
      msg.PeripheralId = options.PeripheralId
    }

    await xapi.Command.UserInterface.Message.TextInput.Display(msg);
  },
  promptRemoveConfirmation: async function (options) {
    if (DisplaySystemConfig.PinProtection.Mode == 'Enabled') {
      await showPinEntry(options);
    } else {
      showNoPinRemovePrompt(options);
    }
  },
  activate: async function (index) {
    let thisFunc = 'preset.activate'
    if (!DisplaySystemConfig.Preset.List[index]) {
      console.warn(`Monitor Preset index [${index}] does not exist, unable to activate`);
      return;
    }

    let thisPreset = DisplaySystemConfig.Preset.List[index].clone();

    console.log(`Preparing to set Monitor Preset index [${index}] || Name: ${thisPreset.Name}`);

    let roleList = [];

    for (const output of thisPreset.MonitorRoles) {
      console.debug(`Setting Output Connector [${output.Connector}] to Role [${output.Role}]`);
      try {
        await xapi.Config.Video.Output.Connector[output.Connector].MonitorRole.set(output.Role)
        roleList.push(`${output.Connector}:${output.Role}`)
      } catch (e) {
        const err = { Context: `Failed to set Monitor Role on Output Connector [${output.Connector}] to Role [${output.Role}]`, Func: thisFunc, Error: e };
        console.error(err)
      }
    }

    console.info(`Monitor Roles for Monitor Preset index [${index}] set || Roles: [${roleList.join(' || ')}]`);

    let matrixList = [];

    currentMatrixRoute = thisPreset.Routes.clone();
    await updateMonitorRole({ UpdateFeedback: true });
    await updateVideoMonitor({ UpdateFeedback: true });
    await updateMatrixFeedback(selectedMakerOutput);

    for (let output of thisPreset.Routes) {
      console.debug(`Setting Video Matrix on Output Connector [${output.Connector}]`);

      if (output.InputOrder.length > 0) {
        for (const [index, input] of output.InputOrder.entries()) {
          let matrixAction = (index == 0 ? 'Replace' : 'Add')
          try {
            await xapi.Command.Video.Matrix.Assign({ Output: output.Connector, SourceId: input, Mode: matrixAction, Layout: output.Layout })
            console.debug(`Matrix Route on Output [${output.Connector}] Set || Input: [${input}] || Action: ${matrixAction} || Index: [${index}] || Layout: [${output.Layout}]`)
          } catch (e) {
            const err = { Context: `Failed to matrix route input source [${input}] to output [${output.Connector}]. Action: ${matrixAction} || Layout: [${output.Layout}]`, Func: thisFunc, Error: e };
            console.error(err)
          }
        }
        matrixList.push(`${output.Connector}:${output.Layout}:[${output.InputOrder.toString()}]`)
      } else {
        try {
          await xapi.Command.Video.Matrix.Reset({ Output: output.Connector })
          console.debug(`Clearing Output [${output.Connector}] Matrix Assignment`);
          matrixList.push(`${output.Connector}:${'Reset'}`)
        } catch (e) {
          const err = { Context: `Failed to clear matrix on output [${output.Connector}].`, Func: thisFunc, Error: e };
          console.error(err)
        }
      }
    }
    console.info(`Video Matrix Routes for Monitor Preset index [${index}] set || Routes: [${matrixList.join(' || ')}]`);
    DisplaySystemConfig.Preset.Current = index;

    await saveDisplaySystemConfig();
    await buildUI.PresetList();
    console.log(`Monitor Preset index [${index}] Set || Name: ${thisPreset.Name}`);
  },
  remove: async function (index) {
    if (index >= 0 && index < DisplaySystemConfig.Preset.List.length) {
      let name = DisplaySystemConfig.Preset.List[index].Name;
      DisplaySystemConfig.Preset.List.splice(index, 1);
      console.warn(`Monitor Preset [${name}] at index [${index}] has been removed`)
    } else {
      console.warn(`Monitor Preset at Index [${index}] is not found, unable to remove, no action taken.`);
    }

    if (DisplaySystemConfig.Preset.Default == index) {
      preset.setDefault('', true)
      console.warn(`Monitor Preset at index [${index}] has been removed as the default preset. No default assigned`);
    }

    if (DisplaySystemConfig.Preset.Default !== null) {
      // Shift Default Down 1
      DisplaySystemConfig.Preset.Default = parseInt(DisplaySystemConfig.Preset.Default - 1)
      if (DisplaySystemConfig.Preset.Default < 0) {
        preset.setDefault('', true)
      }
    }

    DisplaySystemConfig.Preset.Current = null;

    await saveDisplaySystemConfig();
    await buildUI.PresetList();
  },
  rename: async function (index, newName) {
    if (!DisplaySystemConfig.Preset.List[index]) {
      console.warn(`Monitor Preset index [${index}] does not exist, unable to rename`);
      return;
    }

    if (!newName) {
      console.warn(`New Name not defined, unable to rename Monitor Preset at index [${index}]`);
      return
    };

    let oldName = DisplaySystemConfig.Preset.List[index].Name.clone();

    DisplaySystemConfig.Preset.List[index].Name = newName;

    console.info(`Monitor Preset at index [${index}] name changed from [${oldName}] to [${newName}]`)

    await saveDisplaySystemConfig();
    await buildUI.PresetList();
  },
  setDefault: async function (index, removeDefault = false) {
    if (!DisplaySystemConfig.Preset.List[index]) {
      console.warn(`Monitor Preset index [${index}] does not exist, unable to change default`);
      return;
    }

    let oldDefault = null;

    if (DisplaySystemConfig.Preset.Default !== null) {
      oldDefault = DisplaySystemConfig.Preset.Default
    }

    if (removeDefault) {
      DisplaySystemConfig.Preset.Default = null;
      console.log(`Monitor Preset at index [${index}] has been removed as default`)
    } else {
      if (DisplaySystemConfig.Preset.Default == index) {
        console.debug(`Monitor Preset default matches submitted, no action needed`);
        return;
      }
      DisplaySystemConfig.Preset.Default = index;
      console.log(`Monitor Preset default has changed from [${oldDefault}] to [${index}]`)
    }

    await saveDisplaySystemConfig();
    await buildUI.PresetList();
  }
}

function setMakerOutput(output) {
  selectedMakerOutput = parseInt(output);
  console.info(`Maker Output set to [${selectedMakerOutput}]`);
}

function setMakerInput(input) {
  selectedMakerInput = parseInt(input);
  console.info(`Maker Input selected [${selectedMakerInput}]`);
}

function clearMakerInputSelection() {
  selectedMakerInput = null;
  xapi.Command.UserInterface.Extensions.Widget.UnsetValue({ WidgetId: 'dopm~Maker~Matrix:SourceSelect' }).catch(e => console.debug(e));
  console.debug(`Maker Input deselected`);
}

async function updateMatrixFeedback(connectorId) {
  const currentOutputMatrix = getMatrixOrderByOutputId(connectorId);
  let matrixOrder = [];
  if (currentOutputMatrix) {
    matrixOrder = `${currentOutputMatrix.InputOrder.join(', ')}`
  }
  await xapi.Command.UserInterface.Extensions.Widget.SetValue({ WidgetId: 'dopm~Maker~Matrix:RouteOrder', Value: `Route Order: [${matrixOrder}]` })
}

async function updateMonitorRole(options) {
  let thisOutput = selectedMakerOutput.clone();
  let currentRole = await xapi.Config.Video.Output.Connector[thisOutput].MonitorRole.get();

  if (options.Output) {
    thisOutput = options.Output
  }

  if (options.SetRole) {
    let thisNewRole = options.SetRole;
    if (options.SetRole.includes('direction:')) {
      const [, direction] = options.SetRole.split(':');
      const currentPosition = availableMonitorRoleConfigs.indexOf(currentRole);

      let newPosition;

      if (direction == 'increment') {
        newPosition = currentPosition + 1;

        if (newPosition >= availableMonitorRoleConfigs.length) {
          newPosition = 0;
        }
      } else {
        newPosition = currentPosition - 1;
        if (newPosition < 0) {
          newPosition = availableMonitorRoleConfigs.length - 1;
        }
      }
      thisNewRole = availableMonitorRoleConfigs[newPosition];
    }

    currentRole = thisNewRole;
    await xapi.Config.Video.Output.Connector[thisOutput].MonitorRole.set(thisNewRole);
  }

  if (options.UpdateFeedback || options.SetRole) {
    await xapi.Command.UserInterface.Extensions.Widget.SetValue({ WidgetId: 'dopm~Maker~MonitorRole', Value: currentRole });
  }
}

async function updateVideoMonitor(options) {
  let currentVideoMonitor = await xapi.Config.Video.Monitors.get()

  if (options.SetConfig) {
    let thisNewConfig = options.SetConfig;
    if (options.SetConfig.includes('direction:')) {
      const [, direction] = options.SetConfig.split(':');
      const currentPosition = availableMonitorsConfigs.indexOf(currentVideoMonitor);

      let newPosition;

      if (direction == 'increment') {
        newPosition = currentPosition + 1;

        if (newPosition >= availableMonitorsConfigs.length) {
          newPosition = 0;
        }
      } else {
        newPosition = currentPosition - 1;
        if (newPosition < 0) {
          newPosition = availableMonitorsConfigs.length - 1;
        }
      }
      thisNewConfig = availableMonitorsConfigs[newPosition];
    }

    currentVideoMonitor = thisNewConfig;
    await xapi.Config.Video.Monitors.set(thisNewConfig);
  }

  if (options.UpdateFeedback || options.SetConfig) {
    await xapi.Command.UserInterface.Extensions.Widget.SetValue({ WidgetId: 'dopm~Config~MonitorsConfig:Select', Value: currentVideoMonitor });
  }
}

async function updatePinFeedback() {
  await xapi.Command.UserInterface.Extensions.Widget.SetValue({ WidgetId: 'dopm~Config~PinProtection:Mode', Value: DisplaySystemConfig.PinProtection.Mode });
}

handle.ReleasedWidgets = {
  'Presets': {
    'Select': async ({ subAction, data, Value }) => {
      clearTimeout(pressedTimeoutHandler);
      if (pressedSubOptionsOpen && developer.SubOptionsReleaseHandler) {
        pressedSubOptionsOpen = false;
        return;
      }

      if (subAction === 'Single') {
        // Handles Preset Action if it's rendered as a single button
        const [index,] = data.split(':');
        preset.activate(index);
      } else {
        const [index,] = Value.split('~');
        // Handles Preset Action if it's rendered as a group button
        preset.activate(index);
      }
    }
  },
  'Maker': {
    'OutputSelect': async ({ Value }) => {
      setMakerOutput(Value);
      updateMonitorRole({ UpdateFeedback: true });
      updateMatrixFeedback(Value)
    },
    'MonitorRole': async ({ Value }) => {
      updateMonitorRole({ SetRole: `direction:${Value}`, UpdateFeedback: true });
    },
    'Matrix': {
      'SourceSelect': async ({ Value }) => {
        setMakerInput(parseInt(Value));
      },
      'Add': async ({ PeripheralId }) => {
        let contents = {
          Title: 'Please Select a Source',
          Text: 'To Matrix Route to a display, you must select an input source first',
          Duration: 20,
          "Option.1": 'Dismiss'
        }
        if (PeripheralId) {
          contents.PeripheralId = PeripheralId;
        }
        if (!selectedMakerInput) {
          await xapi.Command.UserInterface.Message.Prompt.Display(contents)
          clearMakerInputSelection();
          return;
        }
        await addSourceToMatrix(selectedMakerOutput, selectedMakerInput);
        clearMakerInputSelection();
      },
      'Reset': async () => {
        await clearMatrix(selectedMakerOutput);
        clearMakerInputSelection();
      },
      '_default_': async () => { /* ... */ }
    },
    'PresetSave': async ({ PeripheralId }) => {
      await preset.promptSave({ PeripheralId })
    }
  },
  'Config': {
    'MonitorsConfig': {
      'Select': async ({ Value }) => {
        await updateVideoMonitor({ SetConfig: `direction:${Value}`, UpdateFeedback: true });
      },
      'Help': function ({ PeripheralId }) {
        // Removed due to arge API description causing errors opening
        // let msg = {
        //   Title: 'Video Monitors Config',
        //   Text: monitorsDescription.replace(/\n/gm, ''),
        //   Duration: 120,
        //   'Option.1': 'Dismiss'
        // }
        // if (PeripheralId) {
        //   msg.PeripheralId = PeripheralId
        // }
        // console.log(msg)
        // xapi.Command.UserInterface.Message.Prompt.Display(msg)
      }
    },
    'DisplayName': {
      'Edit': function ({ data, PeripheralId }) {
        showMonitorRenamePrompt({ Connector: data, PeripheralId });
      },
      'Help': function () {
        xapi.Command.UserInterface.Message.Prompt.Display({
          Title: 'Video Output Names',
          Text: 'Name your Video Outputs with a Character Weight 8.0 or less<p>Character Weights outlined below',
          "Option.1": '[Score 1.0] W, M, @',
          "Option.2": '[Score 0.75] A-Z, 0-9',
          "Option.3": `[Score 0.75] iltfj.,:;'\`!- (spaces)`,
          "Option.4": 'Dismiss'
        })
      }
    },
    'PinProtection': {
      'Mode': async function ({ Value }) {
        DisplaySystemConfig.PinProtection.Mode = Value;

        await saveDisplaySystemConfig();
      },
      'Edit': async function ({ data, PeripheralId }) {
        showPinEdit({ FeedbackId: 'dopm_pinEdit_Validate', PeripheralId });
      }
    }
  }
};

let pressedTimeoutHandler = '';

let pressedSubOptionsOpen = false;

handle.PressedWidgets = {
  'Presets': {
    'Select': async ({ subAction, data, Value, PeripheralId }) => {

      let index;

      if (subAction === 'Single') {
        index = data.split(':')[0];
      } else {
        index = Value.split('~')[0];
      }

      const thisPreset = DisplaySystemConfig.Preset.List[index].clone();

      pressedTimeoutHandler = setTimeout(() => {
        if (developer.SubOptionsReleaseHandler) {
          pressedSubOptionsOpen = true;
        }

        let isAlreadyDefault = false;

        if (DisplaySystemConfig.Preset.Default !== null) {
          isAlreadyDefault = DisplaySystemConfig.Preset.Default.toString() === index.toString()
        }

        let defaultAction = `Set as`

        if (isAlreadyDefault) { defaultAction = `Remove` }

        xapi.Command.UserInterface.Message.Prompt.Display({
          Title: 'Monitor Preset Options',
          Text: `Choose an option below to modify<p>${thisPreset.Name} || Index: ${index}`,
          "Option.1": 'Rename Preset',
          "Option.2": `${defaultAction} Default Preset => ${developer.Preset.DefaultTerminator}`,
          "Option.3": '⚠️ Delete Preset ⚠️',
          "Option.4": 'Dismiss',
          FeedbackId: `dop_presetOptions~Index:${index}~isDefault:${isAlreadyDefault}`,
          PeripheralId
        })
      }, (developer.Preset.OptionsTimeout * 1000))
    }
  },
  'Maker': async () => { /* ... */ },
  'Config': async () => { /* ... */ }
};

const mem = {
  init: async function () {
    try {
      await xapi.Command.Macros.Macro.Get({ Name: storageMacroName })
    } catch (e) {
      console.warn({ '⚠ mem Warn ⚠': `Uh-Oh, mem Memory Storage Macro not found, creating ${storageMacroName} macro.` })
      await xapi.Command.Macros.Macro.Save({ Name: storageMacroName }, `let memory = {"_comment": "DO NOT ALTER THIS MACRO, IT'S SUPPORTING ANOTHER SOLUTION"}`);
      console.info({ 'mem Info': `${storageMacroName} macro saved to system, restarting macro runtime...` })
      setTimeout(async function () {
        await xapi.Command.Macros.Runtime.Restart()
      }, 1000)
    }
    return
  },
  read: async function (key) {
    let macro = ''
    try {
      macro = await xapi.Command.Macros.Macro.Get({ Name: storageMacroName, Content: 'True' })
    } catch (e) { }
    return new Promise((resolve, reject) => {
      const raw = macro.Macro[0].Content.replace(/let.*memory.*=\s*{/g, '{');
      let data = JSON.parse(raw);
      let temp;
      if (data[thisMacro] == undefined) {
        data[thisMacro] = {};
        temp = data[thisMacro];
      } else {
        temp = data[thisMacro];
      }
      if (temp[key] != undefined) {
        resolve(temp[key]);
      } else {
        reject({ '⚠ mem Error ⚠': `mem.read Error. Object [${key}] not found in [${storageMacroName}] for Macro [${thisMacro}]` })
      }
    })
  },
  write: async function (key, value) {
    let macro = ''
    try {
      macro = await xapi.Command.Macros.Macro.Get({ Name: storageMacroName, Content: 'True' })
    } catch (e) { };
    return new Promise((resolve) => {
      const raw = macro.Macro[0].Content.replace(/let.*memory.*=\s*{/g, '{');
      let data = JSON.parse(raw);
      let temp;
      if (data[thisMacro] == undefined) {
        data[thisMacro] = {};
        temp = data[thisMacro];
      } else {
        temp = data[thisMacro];
      }
      temp[key] = value;
      data[thisMacro] = temp;
      const newStore = JSON.stringify(data, null, 2);
      xapi.Command.Macros.Macro.Save({ Name: storageMacroName }, `let memory = ${newStore}`).then(() => {
        console.debug({ 'mem Debug': `Local Write Complete`, Location: thisMacro, Data: `{"${key}" : "${value}"}` });
        resolve(value);
      });
    })
  }
}

let DisplaySystemConfig = {};

/**Configures DisplaySystemConfig with initial values first time setup or if information is corrupted */
async function setupPresetMemoryObject() {
  let tempInfo = {};

  tempInfo['PinProtection'] = developer.ftsDefaults.PinProtection.clone();

  tempInfo['OutputNames'] = {};

  const maxOuts = 3;

  for (let i = 0; i < maxOuts; i++) {
    let connector = i + 1;
    tempInfo.OutputNames[connector] = `${developer.ftsDefaults.InitialOutputName.clone()} ${connector}`;
  };

  tempInfo['Preset'] = {}

  tempInfo.Preset['Default'] = null;
  tempInfo.Preset['Current'] = null;
  tempInfo.Preset['List'] = [];

  return new Promise(resolve => { resolve(tempInfo) });
}

async function setCurrentPresetFeedback() {
  // if (DisplaySystemConfig.Preset.Current !== null && DisplaySystemConfig.Preset.Current !== undefined) {
  if (DisplaySystemConfig.Preset.Current === null || DisplaySystemConfig.Preset.Current === undefined) {
    await xapi.Command.UserInterface.Extensions.Widget.UnsetValue({ WidgetId: 'dop~Presets~Select' }).catch(e => console.debug(e));
    return;
  }

  const thisPreset = DisplaySystemConfig.Preset.List[DisplaySystemConfig.Preset.Current];
  const thisIndex = DisplaySystemConfig.Preset.Current

  if (thisIndex && !thisPreset) {
    await xapi.Command.UserInterface.Extensions.Widget.UnsetValue({ WidgetId: 'dop~Presets~Select' }).catch(e => console.debug(e));
    return;
  }

  await xapi.Command.UserInterface.Extensions.Widget.SetValue({ WidgetId: 'dop~Presets~Select', Value: `${thisIndex}~${thisPreset.Name}` });
  return;
  // }
  // return
}

const buildUI = {
  PresetList: async function () {
    let presetXML = ``;

    if (Array.isArray(DisplaySystemConfig.Preset.List)) {
      switch (DisplaySystemConfig.Preset.List.length) {
        case 0:
          // Render Message - No Presets Available
          presetXML = `<Widget>
          <WidgetId>dop~Presets~EmptyText</WidgetId>
          <Name>No Monitor Presets were Found. Use the Monitor Preset Maker tool in the Control Panel to create your first Monitor Preset</Name>
          <Type>Text</Type>
          <Options>size=4;fontSize=small;align=left</Options>
        </Widget>`
          break;
        case 1:
          // Render Button, not Group Button with Preset
          let showIndex = (developer.Preset.ShowIndex ? ` [${0}]` : '');
          let isDefault = (DisplaySystemConfig.Preset.Default == 0);
          presetXML = `<Widget>
          <WidgetId>dop~Presets~Select:Single~${0}:${DisplaySystemConfig.Preset.List[0].Name}</WidgetId>
          <Name>${DisplaySystemConfig.Preset.List[0].Name}${showIndex}${isDefault ? ` ${developer.Preset.DefaultTerminator}` : ''}</Name>
          <Type>Button</Type>
          <Options>size=4</Options>
        </Widget>`
          break;
        default:
          let presetGroupXML = ``;
          DisplaySystemConfig.Preset.List.forEach((preset, index) => {
            let showIndex = (developer.Preset.ShowIndex ? ` [${index}]` : '');
            let isDefault = (DisplaySystemConfig.Preset.Default == index);
            presetGroupXML += `<Value><Key>${index}~${preset.Name}</Key><Name>${preset.Name}${showIndex}${isDefault ? ` ${developer.Preset.DefaultTerminator}` : ''}</Name></Value>`
          })
          presetXML = `<Widget>
          <WidgetId>dop~Presets~Select</WidgetId>
          <Type>GroupButton</Type>
          <Options>size=4;columns=1</Options>
          <ValueSpace>
            ${presetGroupXML}
          </ValueSpace>
        </Widget>`
          break;
      }

      let finalXML = `<Extensions>
          <Panel>
            <Order>1</Order>
            <Origin>local</Origin>
            <Location>HomeScreenAndCallControls</Location>
            <Icon>Tv</Icon>
            <Name>Monitor Presets</Name>
            <ActivityType>Custom</ActivityType>
            <Page>
              <Name>Monitor Presets</Name>
              <Row> <Name/> <Widget> <WidgetId>dop~Presets~DescriptionText</WidgetId> <Name>Select a Monitor Preset to Activate. Press and hold for 3 seconds to open Monitor Preset SubMenu</Name> <Type>Text</Type> <Options>size=4;fontSize=small;align=left</Options> </Widget> </Row> <Row>
                <Name>Select a Preset</Name>
                ${presetXML}
              </Row>
              <PageId>dop~Presets</PageId>
              <Options/>
            </Page>
          </Panel>
        </Extensions>`

      await xapi.Command.UserInterface.Extensions.Panel.Save({ PanelId: 'dop' }, finalXML);

      await setCurrentPresetFeedback();

    } else {
      throw new Error(`Monitor Preset Array is Malformed and needs attention. Received type: ${typeof DisplaySystemConfig.Preset.List}`);
    }
  },
  PresetMaker: async function () {
    // Place Pin Warning on both pages if the current pin matches the default pin
    let makerPinWarningHeader = `<Row> <Name>Pin Warning</Name> <Widget> <WidgetId>dopm~Maker~Warnings</WidgetId> <Name>${defaultPinWarning}</Name> <Type>Text</Type> <Options>size=4;fontSize=normal;align=left</Options> </Widget> </Row>`;
    if (DisplaySystemConfig.PinProtection.Pin !== developer.ftsDefaults.PinProtection.Pin) { makerPinWarningHeader = ``; }
    let configPinWarningHeader = makerPinWarningHeader.clone();

    // Grab the available Video output Connectors and build the Group Button to Select them on the Maker Page
    // Use this same information to render the Names on the Config Page
    const videoOutputConnectors = await xapi.Config.Video.Output.Connector.get();
    let videoOutputSelectValueXML = ``;
    let videoOutputConfigNameXML = ``;

    videoOutputConnectors.forEach((output, index) => {
      output['_name'] = DisplaySystemConfig.OutputNames[output.id];
      videoOutputSelectValueXML += `<Value> <Key>${output.id}</Key> <Name>${output._name}</Name> </Value>`;

      videoOutputConfigNameXML += `<Row>
        <Name>${index == 0 ? 'Video Output Names' : ''}</Name>
        <Widget>
          <WidgetId>dopm~Config~DisplayName:Text~${output.id}</WidgetId>
          <Name>${output._name}</Name>
          <Type>Text</Type>
          <Options>size=2;fontSize=normal;align=left</Options>
        </Widget>
        <Widget>
          <WidgetId>dopm~Config~DisplayName:Edit~${output.id}</WidgetId>
          <Name>Edit</Name>
          <Type>Button</Type>
          <Options>size=1</Options>
        </Widget>
        ${index == 0 ?
          `<Widget> <WidgetId>dopm~Config~DisplayName:Help</WidgetId> <Type>Button</Type> <Options>size=1;icon=help</Options> </Widget>`
          : `<Widget> <WidgetId>dopm~Config~DisplayName:Spacer~${output.id}</WidgetId> <Type>Spacer</Type> <Options>size=1</Options> </Widget>`
        }</Row>`;
    })

    // Grab the available Video output Connectors and build the Group Button to Select them on the Maker Page
    const videoInputConnectors = await xapi.Config.Video.Input.Connector.get();
    let videoInputSelectValueXML = ``;

    videoInputConnectors.forEach(input => {
      videoInputSelectValueXML += `<Value> <Key>${input.id}</Key> <Name>${input.Name} | ID:${input.id}</Name> </Value>`
    })

    let visibleXML = `<Extensions>
        <Panel>
          <Order>2</Order>
          <Location>ControlPanel</Location>
          <Icon>Tv</Icon>
          <Color>#C74F0E</Color>
          <Name>Monitor Preset Maker</Name>
          <ActivityType>Custom</ActivityType>
        </Panel>
      </Extensions>
      `

    let hiddenXML = `<Extensions>
        <Panel>
          <Order>3</Order>
          <PanelId>dopm</PanelId>
          <Origin>local</Origin>
          <Location>Hidden</Location>
          <Icon>Tv</Icon>
          <Color>#C74F0E</Color>
          <Name>Monitor Preset Maker</Name>
          <ActivityType>Custom</ActivityType>
          <Page>
            <Name>Monitor Preset Maker</Name>
            ${makerPinWarningHeader}
            <Row> <Name>Select Output</Name> <Widget> <WidgetId>dopm~Maker~OutputSelect</WidgetId> <Type>GroupButton</Type> <Options>size=3</Options> <ValueSpace> ${videoOutputSelectValueXML} </ValueSpace> </Widget> </Row>
            <Row> <Name>Change Role</Name> <Widget> <WidgetId>dopm~Maker~MonitorRole</WidgetId> <Type>Spinner</Type> <Options>size=4;style=horizontal</Options> </Widget> </Row>
            <Row> <Name>Matrix Route</Name> <Widget> <WidgetId>dopm~Maker~Matrix:SourceSelect</WidgetId> <Type>GroupButton</Type> <Options>size=4;columns=2</Options> <ValueSpace> ${videoInputSelectValueXML} </ValueSpace> </Widget>
            <Widget>
              <WidgetId>dopm~Maker~Matrix:RouteOrder</WidgetId>
              <Name>Route Order: []</Name>
              <Type>Text</Type>
              <Options>size=2;fontSize=small;align=left</Options>
            </Widget>
           <Widget> <WidgetId>dopm~Maker~Matrix:Add</WidgetId> <Name>Add</Name> <Type>Button</Type> <Options>size=1</Options> </Widget> <Widget> <WidgetId>dopm~Maker~Matrix:Reset</WidgetId> <Name>Reset</Name> <Type>Button</Type> <Options>size=1</Options> </Widget> </Row>
            <Row> <Name>Save Preset</Name> <Widget> <WidgetId>dopm~Maker~PresetSave</WidgetId> <Name>Save Preset</Name> <Type>Button</Type> <Options>size=4</Options> </Widget> </Row>
            <Options/>
          </Page>
          <Page>
            <Name>Config</Name>
              ${configPinWarningHeader}
            <Row> <Name>Video Monitors Config</Name> 
              <Widget> <WidgetId>dopm~Config~MonitorsConfig:Select</WidgetId> <Type>Spinner</Type> <Options>size=4;style=horizontal</Options> </Widget>
              <_comment>Set Spinner size to 4 and removed the help button</_comment>
              <!-- <Widget> <WidgetId>dopm~Config~MonitorsConfig:Help</WidgetId> <Type>Button</Type> <Options>size=1;icon=help</Options> </Widget> -->
            </Row>
              ${videoOutputConfigNameXML}
            <Row> <Name>Pin Protection</Name> <Widget> <WidgetId>dopm~Config~PinProtection:Mode</WidgetId> <Type>GroupButton</Type> <Options>size=4;columns=2</Options> <ValueSpace> <Value> <Key>Disabled</Key> <Name>Disabled</Name> </Value> <Value> <Key>Enabled</Key> <Name>Enabled</Name> </Value> </ValueSpace> </Widget> <Widget> <WidgetId>dopm~Config~PinProtection:Edit</WidgetId> <Name>Change Pin</Name> <Type>Button</Type> <Options>size=2</Options> </Widget> </Row>
            <Options/>
          </Page>
        </Panel>
      </Extensions>
      `

    await xapi.Command.UserInterface.Extensions.Panel.Save({ PanelId: 'dopm_visible' }, visibleXML);
    await xapi.Command.UserInterface.Extensions.Panel.Save({ PanelId: 'dopm_hidden' }, hiddenXML);
  }
}

let availableMonitorsConfigs = videoMonitorsOrderTemplate.clone();

/**Unused. Too large for Prompt API */
let monitorsDescription = `A monitor role is assigned to each screen using the Video Output Connector [n] MonitorRole setting. The monitor role decides which layout (call participants and presentation) will appear on the screen that is connected to this output. Screens with the same monitor role will get the same layout; screens with different monitor roles will have different layouts.The monitor layout mode that is set in the Video Monitors setting should reflect the number of different layouts you want in your room setup. Note that some screens can be reserved for presentations.`;

let availableMonitorRoleConfigs = monitorRoleOrderTemplate.clone();

async function uptimeHandler(delayInMinutes = 3) {
  const targetUptimeMs = delayInMinutes * 1000 * 60;
  let currentUptime = (await xapi.Status.SystemUnit.Uptime.get() * 1000)

  console.log(`Checking system uptime...`);
  if (currentUptime < targetUptimeMs) {
    console.log(`Waiting for system uptime to reach a minimum uptime of ${delayInMinutes} minutes...`)
  }

  while (currentUptime < targetUptimeMs) {
    try {
      currentUptime = (await xapi.Status.SystemUnit.Uptime.get() * 1000)
    } catch (error) {
      console.error("Error getting system uptime:", error);
    }

    if (currentUptime < targetUptimeMs) {
      await delay(1000); // Wait 1 second before checking again
    }
  }
  console.log(`System uptime of ${delayInMinutes} minutes reached!`);
  return currentUptime
}

async function init() {
  console.info(`Initializing [${thisMacro}] || Version: [${version}]`);

  const uptimeBootWindow = 2;
  const uptimeDelay = 2;

  const uptime = await uptimeHandler(uptimeDelay);

  // Establish the number of displays for this device and setup currentMatrix object
  const numDisplays = (await xapi.Config.Video.Output.Connector.get()).length;
  for (let i = 0; i < numDisplays; i++) {
    currentMatrixRoute.push({ "Connector": i + 1, "Layout": "Equal", "InputOrder": [] })
  }

  // Initialize Memory
  await mem.init()

  try {
    // Pull Local Device Config Values for Video Monitors
    const monitorsConfig = await xapi.doc('Configuration Video Monitors')

    // Parse Video Monitors Description for Help Button
    monitorsDescription = monitorsConfig.description;

    // Compare and sort available Video Monitors config based on Template
    availableMonitorsConfigs = monitorsConfig.ValueSpace.Value.orderByTemplate(videoMonitorsOrderTemplate)
  } catch (e) {
    const err = { Context: 'Failed to fetch Video Monitors configuration', Error: e };
    console.warn(err)
  }

  try {
    // Pull Local Device Config Values for Monitor Roles
    const monitorRolesConfig = await xapi.doc('Configuration Video Output Connector 2 MonitorRole')

    // Compare and sort available Monitor Roles config based on Template
    availableMonitorRoleConfigs = monitorRolesConfig.ValueSpace.Value.orderByTemplate(monitorRoleOrderTemplate)
  } catch (e) {
    const err = { Context: 'Failed to fetch Monitor Role 2 configuration', Error: e };
    console.warn(err)
  }

  try {
    DisplaySystemConfig = await mem.read('DisplaySystemConfig');
    console.debug(`DisplaySystemConfig Recovered:`, DisplaySystemConfig);
  } catch (e) {
    if (e.toString().includes('Object') && e.toString().includes('not found')) {
      console.debug(`DisplaySystemConfig missing, generating default`);
      DisplaySystemConfig = await setupPresetMemoryObject();
      await mem.write('DisplaySystemConfig', DisplaySystemConfig)
      console.debug(`DisplaySystemConfig missing, default generated`);
    } else {
      throw (e)
    }
  }

  if (uptime <= ((uptimeDelay + uptimeBootWindow) * 60 * 1000)) {
    console.debug(`Boot Detected, handling Monitor Preset startup`)
    if (DisplaySystemConfig.Preset.Default !== null) {
      await preset.activate(DisplaySystemConfig.Preset.Default);
      console.log(`On Boot, applied Default Monitor Preset`)
      return;
    }

    if (DisplaySystemConfig.Preset.Current !== null) {
      await preset.activate(DisplaySystemConfig.Preset.Current);
      console.log(`On Boot, applied Last Known Monitor Preset selected`)
      return;
    }
  } else {
    console.debug(`Macro Runtime Restart Detected, retrieving routes`)
    if (DisplaySystemConfig.Preset.Current !== null) {
      currentMatrixRoute = DisplaySystemConfig.Preset.List[DisplaySystemConfig.Preset.Current].Routes
    }
  }

  await buildUI.PresetList();
  await buildUI.PresetMaker();

  await StartSubscriptions();

  await updateMonitorRole({ UpdateFeedback: true });
  await updateVideoMonitor({ UpdateFeedback: true });
  await updatePinFeedback()
}

init();