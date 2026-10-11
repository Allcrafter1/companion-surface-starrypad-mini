import { Input, Output } from "@julusian/midi/lazy";

let _input: Input | undefined = undefined;
let _output: Output | undefined = undefined;

export function getInputs(): string[] {
  const inputs: string[] = [];
  try {
    _input ??= new Input(); // Lazy load
    for (let i = 0; i < _input.getPortCount(); i++) {
      let counter = 0;
      const portName = _input.getPortName(i);
      let numberedPortName = portName;
      while (inputs.includes(numberedPortName)) {
        counter++;
        numberedPortName = `${portName} ${counter}`;
      }
      inputs.push(numberedPortName);
    }
  } catch {
    /* empty */
  }
  return inputs;
}

export function getOutputs(): string[] {
  const outputs: string[] = [];
  try {
    _output ??= new Output(); // Lazy load
    for (let i = 0; i < _output.getPortCount(); i++) {
      let counter = 0;
      const portName = _output.getPortName(i);
      let numberedPortName = portName;
      while (outputs.includes(numberedPortName)) {
        counter++;
        numberedPortName = `${portName} ${counter}`;
      }
      outputs.push(numberedPortName);
    }
  } catch {
    /* empty */
  }
  return outputs;
}
