import { describe, it, expect, vi } from 'vitest';
import extension from '../index.js';

describe('Ultraplan Command', () => {
  it('should register ultraplan and call pi.exec 5 times', async () => {
    const commands = new Map<string, any>();
    
    // Mock the ExtensionAPI
    const mockPi: any = {
      registerCommand: (name: string, def: any) => {
        commands.set(name, def);
      },
      on: vi.fn(),
      exec: vi.fn().mockResolvedValue({ stdout: "Mock review output" }),
      sendUserMessage: vi.fn()
    };

    const mockCtx: any = {
      ui: {
        confirm: vi.fn().mockResolvedValue(true),
        custom: vi.fn().mockImplementation(async (callback: any) => {
          // Execute the custom UI callback
          // Mock tui, theme, keybindings, done
          const mockTheme = { fg: vi.fn().mockReturnValue(""), bold: vi.fn().mockReturnValue(""), dim: vi.fn().mockReturnValue("") };
          
          return new Promise((resolve) => {
            const done = (res: any) => { resolve(res); };
            callback({ invalidate: vi.fn() }, mockTheme, {}, done);
          });
        })
      }
    };

    // Load extension
    extension(mockPi);

    // Get the ultraplan handler
    const ultraplan = commands.get('ultraplan');
    expect(ultraplan).toBeDefined();

    // Execute the handler
    await ultraplan.handler('', mockCtx);

    // Verify pi.exec was called 5 times for the 5 agents
    expect(mockPi.exec).toHaveBeenCalledTimes(5);
    
    // Verify sendUserMessage was called with the synthesized prompt
    expect(mockPi.sendUserMessage).toHaveBeenCalled();
    const finalPrompt = mockPi.sendUserMessage.mock.calls[0][0];
    expect(finalPrompt).toContain("Mock review output");
  });
});
