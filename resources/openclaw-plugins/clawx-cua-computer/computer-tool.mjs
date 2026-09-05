import { computerDriverError } from './mcp-client.mjs';

export const COMPUTER_ACTIONS = Object.freeze([
  'screenshot',
  'left_click',
  'right_click',
  'middle_click',
  'double_click',
  'triple_click',
  'mouse_move',
  'left_click_drag',
  'scroll',
  'type',
  'key',
  'wait',
]);

const TARGET = Object.freeze({ kind: 'desktop', display_id: 'primary' });
const COORDINATE_ACTIONS = new Set([
  'left_click',
  'right_click',
  'middle_click',
  'double_click',
  'triple_click',
  'mouse_move',
  'left_click_drag',
  'scroll',
]);
const MODIFIER_ALIASES = new Map([
  ['cmd', 'meta'],
  ['command', 'meta'],
  ['meta', 'meta'],
  ['win', 'meta'],
  ['super', 'meta'],
  ['control', 'ctrl'],
  ['ctrl', 'ctrl'],
  ['option', 'alt'],
  ['alt', 'alt'],
  ['shift', 'shift'],
]);
const NAMED_KEY_ALIASES = new Map([
  ['enter', 'enter'],
  ['return', 'enter'],
  ['tab', 'tab'],
  ['space', 'space'],
  ['spacebar', 'space'],
  ['backspace', 'backspace'],
  ['delete', 'delete'],
  ['del', 'delete'],
  ['insert', 'insert'],
  ['ins', 'insert'],
  ['escape', 'escape'],
  ['esc', 'escape'],
  ['capslock', 'capslock'],
  ['numlock', 'numlock'],
  ['home', 'home'],
  ['end', 'end'],
  ['pageup', 'pageup'],
  ['pgup', 'pageup'],
  ['pagedown', 'pagedown'],
  ['pgdn', 'pagedown'],
  ['left', 'left'],
  ['arrowleft', 'left'],
  ['right', 'right'],
  ['arrowright', 'right'],
  ['up', 'up'],
  ['arrowup', 'up'],
  ['down', 'down'],
  ['arrowdown', 'down'],
]);

function toolError(message) {
  return computerDriverError('COMPUTER_DRIVER_ERROR', message);
}

function pick(params, camelName, snakeName) {
  return params[camelName] ?? params[snakeName];
}

function requireCoordinate(value, label = 'coordinate') {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) {
    throw toolError(`${label} must contain two finite numbers`);
  }
  return value;
}

function requirePositiveNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw toolError(`${label} must be a positive number`);
  }
  return value;
}

export function parseKeyCombination(value) {
  if (typeof value !== 'string' || !value.trim()) throw toolError('key must be a non-empty string');
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean);
  const modifiers = [];
  const keys = [];
  for (const rawPart of parts) {
    const part = rawPart.toLowerCase();
    const modifier = MODIFIER_ALIASES.get(part);
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }
    if (/^[a-z]$/u.test(part)) {
      keys.push(part);
      continue;
    }
    if (/^f(?:[1-9]|1[0-2])$/u.test(part)) {
      keys.push(part);
      continue;
    }
    const namedKey = NAMED_KEY_ALIASES.get(part);
    if (namedKey) {
      keys.push(namedKey);
      continue;
    }
    if (/^[0-9]$/u.test(part) || /[^a-z0-9_]/u.test(part)) {
      throw toolError('layout-dependent punctuation is not supported by key actions');
    }
    throw toolError(`unsupported named key: ${rawPart}`);
  }
  if (keys.length !== 1) throw toolError('key actions require exactly one non-modifier key');
  return { key: keys[0], modifiers };
}

export function mapComputerAction(params) {
  if (!params || typeof params !== 'object' || !COMPUTER_ACTIONS.includes(params.action)) {
    throw toolError(`action must be one of: ${COMPUTER_ACTIONS.join(', ')}`);
  }
  const coordinate = params.coordinate;
  switch (params.action) {
    case 'screenshot':
      return { toolName: 'get_desktop_state', arguments: {} };
    case 'left_click':
    case 'right_click':
    case 'middle_click':
    case 'double_click':
    case 'triple_click': {
      const [x, y] = requireCoordinate(coordinate);
      const button = params.action === 'right_click'
        ? 'right'
        : params.action === 'middle_click' ? 'middle' : 'left';
      const count = params.action === 'double_click' ? 2 : params.action === 'triple_click' ? 3 : 1;
      return { toolName: 'click', arguments: { x, y, button, count, target: TARGET } };
    }
    case 'mouse_move': {
      const [x, y] = requireCoordinate(coordinate);
      return { toolName: 'move_cursor', arguments: { x, y, target: TARGET } };
    }
    case 'left_click_drag': {
      const [fromX, fromY] = requireCoordinate(pick(params, 'startCoordinate', 'start_coordinate'), 'start_coordinate');
      const [toX, toY] = requireCoordinate(coordinate);
      const durationSeconds = params.duration === undefined ? 0.5 : requirePositiveNumber(params.duration, 'duration');
      return {
        toolName: 'drag',
        arguments: {
          from_x: fromX,
          from_y: fromY,
          to_x: toX,
          to_y: toY,
          duration_ms: Math.min(10_000, Math.round(durationSeconds * 1000)),
          target: TARGET,
        },
      };
    }
    case 'scroll': {
      const [x, y] = requireCoordinate(coordinate);
      const direction = pick(params, 'scrollDirection', 'scroll_direction');
      if (!['up', 'down', 'left', 'right'].includes(direction)) {
        throw toolError('scrollDirection must be up, down, left, or right');
      }
      const rawAmount = pick(params, 'scrollAmount', 'scroll_amount');
      const amount = Math.min(50, Math.max(1, Math.round(requirePositiveNumber(rawAmount ?? 3, 'scrollAmount'))));
      return {
        toolName: 'scroll',
        arguments: { x, y, direction, by: 'line', amount, target: TARGET },
      };
    }
    case 'type':
      if (typeof params.text !== 'string' || params.text.length === 0) throw toolError('text must be a non-empty string');
      return { toolName: 'type_text', arguments: { text: params.text, target: TARGET } };
    case 'key': {
      const combination = parseKeyCombination(params.text ?? params.key);
      return { toolName: 'press_key', arguments: { ...combination, target: TARGET } };
    }
    case 'wait':
      return { toolName: null, arguments: {} };
    default:
      throw toolError(`unsupported action: ${params.action}`);
  }
}

function validateFrameCoordinate(coordinate, frame, label = 'coordinate') {
  const [x, y] = requireCoordinate(coordinate, label);
  if (x < 0 || y < 0) throw toolError(`${label} values must be non-negative`);
  if (x >= frame.width || y >= frame.height) {
    throw toolError(`${label} is outside the current ${frame.width}x${frame.height} screenshot`);
  }
}

function validPngBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) return false;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return false;
  return Buffer.from(value, 'base64').subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

export function parseScreenshotResult(result, { generation, action }) {
  const structured = result?.structuredContent;
  const image = Array.isArray(result?.content)
    ? result.content.find((item) => item?.type === 'image' && item.mimeType === 'image/png')
    : null;
  const width = structured?.screenshot_width;
  const height = structured?.screenshot_height;
  const screenWidth = structured?.screen_width;
  const screenHeight = structured?.screen_height;
  if (!validPngBase64(image?.data)) throw toolError('CUA screenshot did not contain valid PNG base64 data');
  if (![width, height, screenWidth, screenHeight].every((value) => Number.isInteger(value) && value > 0)) {
    throw toolError('CUA screenshot dimensions are missing or invalid');
  }

  return {
    frame: { generation, width, height },
    result: {
      content: [
        { type: 'text', text: `Primary desktop screenshot captured at ${width}x${height}.` },
        { type: 'image', data: image.data, mimeType: 'image/png' },
      ],
      details: {
        generation,
        action,
        width,
        height,
        nativeWidth: width,
        nativeHeight: height,
        screenWidth,
        screenHeight,
        media: { outbound: false },
      },
    },
  };
}

function inputResultText(result, action) {
  const text = Array.isArray(result?.content)
    ? result.content
      .filter((item) => item?.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join('\n')
    : '';
  return text || `${action} completed successfully.`;
}

const parameters = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: COMPUTER_ACTIONS },
    coordinate: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: { type: 'number' },
      description: 'Target [x, y] in pixels from the latest screenshot.',
    },
    start_coordinate: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: { type: 'number' },
      description: 'Drag start [x, y] in pixels from the latest screenshot.',
    },
    text: { type: 'string', description: 'Text to type or key chord to press.' },
    scroll_direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
    scroll_amount: { type: 'number', minimum: 1, description: 'Scroll lines; values above 50 are capped.' },
    duration: { type: 'number', minimum: 0, maximum: 100, description: 'Wait or drag duration in seconds.' },
  },
};

export function createComputerTool({ proxyManager, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let frame = null;
  return {
    name: 'computer',
    label: 'Computer',
    description: 'Capture and control the local primary desktop through ClawX.',
    parameters,
    async execute(_toolCallId, params) {
      return proxyManager.execute(async ({ generation, callTool }) => {
        if (frame && frame.generation !== generation) frame = null;
        if (COORDINATE_ACTIONS.has(params.action)) {
          if (!frame) throw toolError('A screenshot from the same descriptor generation is required before coordinate actions');
          validateFrameCoordinate(params.coordinate, frame);
          if (params.action === 'left_click_drag') {
            validateFrameCoordinate(pick(params, 'startCoordinate', 'start_coordinate'), frame, 'start_coordinate');
          }
        }

        if (params.action === 'screenshot') {
          const parsed = parseScreenshotResult(
            await callTool('get_desktop_state', {}),
            { generation, action: params.action },
          );
          frame = parsed.frame;
          return parsed.result;
        }

        if (params.action === 'wait') {
          const duration = params.duration ?? 1;
          if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || duration > 100) {
            throw toolError('wait duration must be within 0-100 seconds');
          }
          await sleep(duration * 1000);
          const successText = `Waited ${duration} seconds successfully.`;
          try {
            const parsed = parseScreenshotResult(
              await callTool('get_desktop_state', {}),
              { generation, action: params.action },
            );
            frame = parsed.frame;
            parsed.result.content[0].text = `${successText}\n${parsed.result.content[0].text}`;
            return parsed.result;
          } catch (error) {
            frame = null;
            return {
              content: [{
                type: 'text',
                text: `${successText}\nThe follow-up screenshot failed: ${error.message || String(error)}`,
              }],
              details: { generation, action: params.action },
            };
          }
        }

        const mapped = mapComputerAction(params);
        frame = null;
        const inputResult = await callTool(mapped.toolName, mapped.arguments);
        const successText = inputResultText(inputResult, params.action);
        await sleep(500);
        try {
          const parsed = parseScreenshotResult(
            await callTool('get_desktop_state', {}),
            { generation, action: params.action },
          );
          frame = parsed.frame;
          parsed.result.content[0].text = `${successText}\n${parsed.result.content[0].text}`;
          return parsed.result;
        } catch (error) {
          frame = null;
          return {
            content: [{
              type: 'text',
              text: `${successText}\nThe input succeeded, but the follow-up screenshot failed: ${error.message || String(error)}`,
            }],
            details: { generation, action: params.action },
          };
        }
      });
    },
  };
}
