# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About OpenTUI

OpenTUI is a TypeScript library for building terminal user interfaces (TUIs). It combines TypeScript with Zig for high-performance rendering and supports both 2D and 3D graphics, physics simulations, and rich UI components.

## Runtime & Tools

**Runtime**: Bun with TypeScript (prefer Bun over Node.js)
- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install`
- Use `bun run <script>` instead of `npm run <script>`

## Build Commands

### Zig Native Components
```bash
# Production build (all platforms)
cd src/zig && zig build

# Debug build  
cd src/zig && zig build -Doptimize=Debug

# Release build (optimized)
cd src/zig && zig build -Doptimize=ReleaseFast

# Platform-specific build
cd src/zig && zig build -Dtarget=x86_64-linux
```

### TypeScript/Bun
```bash
# Run examples
bun run src/examples/index.ts

# Run tests
bun test

# Run specific test
bun test src/animation/Timeline.test.ts
```

## Architecture Overview

### Core Components

**CliRenderer**: The main rendering engine that manages the terminal interface
- Located in `src/index.ts:153`
- Handles terminal setup, input processing, frame loops, and mouse events
- Uses Zig backend for optimized rendering via `resolveRenderLib()`

**Renderable**: Base class for all drawable objects (`src/Renderable.ts`)
- Hierarchical system with parent-child relationships
- Position, z-index, visibility management
- Mouse event propagation

**Optimized Buffer**: Zig-backed buffer system for fast terminal rendering
- Created via `lib.createOptimizedBuffer()`
- Supports RGBA color, text rendering, and post-processing

### UI System (`src/ui/`)

**Layout Engine**: Flexbox-like layout system using yoga-layout
- Located in `src/ui/layout.ts`
- Supports flex direction, wrap, justification, alignment

**Components**:
- **InputElement** (`src/ui/elements/input.ts`): Text input with validation
- **SelectElement** (`src/ui/elements/select.ts`): Dropdown selection
- **TabController** (`src/ui/elements/tab-controller.ts`): Tab navigation

**Font System**: ASCII art font rendering (`src/ui/ascii.font.ts`)
- Multiple font faces: "tiny", "block", "shade", "slick"
- Font files in `src/ui/fonts/`

### 3D Rendering (`src/3d/`)

**WGPURenderer**: WebGPU-based 3D renderer
- Sprite management, texture loading, shader pipeline
- Located in `src/3d/WGPURenderer.ts`

**Animation System**:
- **Timeline** (`src/animation/Timeline.ts`): Keyframe animation system
- **SpriteAnimator** (`src/3d/animation/SpriteAnimator.ts`): Sprite animation
- **Physics integration**: Planck.js and Rapier physics adapters

### Native Integration

**Zig Backend** (`src/zig/`):
- `lib.zig`: Main library interface
- `renderer.zig`: Terminal rendering engine  
- `buffer.zig`: Optimized buffer implementation
- Builds to platform-specific libraries in `src/zig/lib/`

## Development Patterns

### Creating Renderables
```typescript
class MyRenderable extends Renderable {
  protected renderSelf(buffer: OptimizedBuffer): void {
    buffer.drawText("Content", this.x, this.y, RGBA.white)
  }
}

const obj = new MyRenderable("my-obj", { x: 10, y: 5, zIndex: 1 })
renderer.add(obj)
```

### Input Handling
- Use `getKeyHandler()` from `src/ui/lib/KeyHandler.ts`
- Mouse events automatically propagated to renderables
- Event types: 'click', 'drag', 'over', 'out', 'drop'

### Frame Callbacks
```typescript
renderer.setFrameCallback(async (deltaTime) => {
  // Animation or update logic
})
```

## Code Style

- **Formatting**: Prettier (semi: false, printWidth: 120)
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Types**: Explicit return types for public APIs
- **Imports**: Group by built-ins, external deps, internal modules
- **Testing**: Bun test framework with descriptive names

## Examples

The `src/examples/` directory contains comprehensive demos:
- Layout system, input/select components, styled text
- 3D rendering, shaders, physics simulations  
- Mouse interaction, sprite animation, particles
- Run via `bun run src/examples/index.ts`