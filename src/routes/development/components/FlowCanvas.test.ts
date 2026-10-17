import { describe, expect, it, vi } from 'vitest'
import { mount, tick } from 'svelte'
import { fireEvent, getByText } from '@testing-library/svelte'
import FlowCanvas from './FlowCanvas.svelte'
import { createDefaultFlowGraph, type FlowGraph } from '../flowTypes.js'

describe('FlowCanvas', () => {
  it('renders toolbar buttons and flow nodes', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = createDefaultFlowGraph()
    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: { testEnv: { baseUrl: 'https://api.test' } },
        activeEnvName: 'testEnv',
        globalProxy: ''
      }
    })

    expect(getByText(target, 'Run Flow')).toBeTruthy()
    expect(getByText(target, '＋ REST Block')).toBeTruthy()
    expect(getByText(target, '＋ Logic & Code')).toBeTruthy()
    expect(getByText(target, '＋ Flow Control')).toBeTruthy()
    expect(getByText(target, '＋ Event')).toBeTruthy()
    expect(getByText(target, 'Auto Layout')).toBeTruthy()
    expect(getByText(target, 'File')).toBeTruthy()

    // Should have 7 nodes rendered in default Rick & Morty flow
    expect(target.querySelectorAll('.flow-node').length).toBe(7)
    // Connections rendered in SVG
    expect(target.querySelectorAll('.conn-line').length).toBe(5)
  })

  it('adds a new JS node when clicking + Logic & Code', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = { nodes: [], connections: [] }
    const onSaveGraph = vi.fn()

    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: '',
        onSaveGraph
      }
    })

    const addJsBtn = getByText(target, '＋ Logic & Code')
    await fireEvent.click(addJsBtn)
    await tick()

    expect(target.querySelectorAll('.flow-node').length).toBe(1)
    expect(target.querySelector('.flow-node-js')).toBeTruthy()
  })

  it('shows round ball on arrow when clicking connection and switches between Blue and Purple', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = createDefaultFlowGraph()
    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    // Initially, ball control is hidden to keep lines clean
    expect(target.querySelector('.conn-ball-control')).toBeNull()

    // Click the connection line to show the round ball control ("bola em cima da seta")
    const connHitbox = target.querySelector('.conn-hitbox') as SVGPathElement
    expect(connHitbox).toBeTruthy()
    await fireEvent.click(connHitbox)
    await tick()

    const ball = target.querySelector('.conn-ball-control') as HTMLElement
    expect(ball).toBeTruthy()
    const blueBtn = ball.querySelector('.ball-dot-btn.blue') as HTMLButtonElement
    const purpleBtn = ball.querySelector('.ball-dot-btn.purple') as HTMLButtonElement
    expect(blueBtn).toBeTruthy()
    expect(purpleBtn).toBeTruthy()
    expect(blueBtn.textContent).toContain('Blue')
    expect(purpleBtn.textContent).toContain('Purple')
    expect(blueBtn.classList.contains('active')).toBe(true)

    // Switch to Purple (dotted arrow)
    await fireEvent.click(purpleBtn)
    await tick()

    const ballAfter = target.querySelector('.conn-ball-control') as HTMLElement
    const purpleAfter = ballAfter.querySelector('.ball-dot-btn.purple') as HTMLButtonElement
    expect(purpleAfter.classList.contains('active')).toBe(true)
    expect(ballAfter.classList.contains('is-dotted')).toBe(true)
  })

  it('shows round ball on arrow immediately upon creating a new link between boxes', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph: FlowGraph = {
      nodes: [
        { id: 'n1', type: 'rest', title: 'Box 1', x: 50, y: 50, status: 'idle' },
        { id: 'n2', type: 'rest', title: 'Box 2', x: 450, y: 50, status: 'idle' }
      ],
      connections: []
    }
    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    expect(target.querySelector('.conn-ball-control')).toBeNull()

    // Start drag from n1 output port
    const outputPort = target.querySelector('.port-output') as HTMLElement
    expect(outputPort).toBeTruthy()
    await fireEvent.mouseDown(outputPort)
    await tick()

    // Release on n2 input port (or on n2 node)
    const inputPorts = target.querySelectorAll('.port-input')
    const n2InputPort = inputPorts[1] as HTMLElement
    expect(n2InputPort).toBeTruthy()
    await fireEvent.mouseUp(n2InputPort)
    await tick()

    // Connection created and ball immediately visible on top of the arrow
    const ball = target.querySelector('.conn-ball-control') as HTMLElement
    expect(ball).toBeTruthy()
    expect(ball.textContent).toContain('Blue')
    expect(ball.textContent).toContain('Purple')
  })

  it('supports dragging and dropping a new block onto the canvas', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: createDefaultFlowGraph(),
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    const initialNodes = target.querySelectorAll('.flow-node').length
    const canvas = target.querySelector('.flow-canvas') as HTMLElement
    expect(canvas).toBeTruthy()

    // Trigger dragover and drop of REST node
    await fireEvent.dragOver(canvas, {
      dataTransfer: { types: ['application/x-flow-node-type'] }
    })
    await fireEvent.drop(canvas, {
      clientX: 400,
      clientY: 300,
      dataTransfer: {
        getData: (format: string) => (format === 'text/plain' ? 'rest' : '')
      }
    })
    await tick()

    expect(target.querySelectorAll('.flow-node').length).toBe(initialNodes + 1)
  })

  it('controls zoom in and zoom out via toolbar buttons', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: createDefaultFlowGraph(),
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    const zoomContainer = target.querySelector('.flow-zoom-container') as HTMLElement
    expect(zoomContainer.style.transform).toBe('scale(1)')

    const zoomInBtn = target.querySelector(
      '.flow-zoom-control button[title*="Zoom in"]'
    ) as HTMLButtonElement
    await fireEvent.click(zoomInBtn)
    await tick()

    expect(zoomContainer.style.transform).toContain('scale(1.15)')

    const resetBtn = target.querySelector(
      '.flow-zoom-control button[title*="Reset"]'
    ) as HTMLButtonElement
    await fireEvent.click(resetBtn)
    await tick()

    expect(zoomContainer.style.transform).toBe('scale(1)')
  })

  it('adds is-dragging class on pointer down and moves node', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: createDefaultFlowGraph(),
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    const firstNode = target.querySelector('.flow-node') as HTMLElement
    expect(firstNode).toBeTruthy()
    expect(firstNode.classList.contains('is-dragging')).toBe(false)

    await fireEvent.mouseDown(firstNode, { button: 0, clientX: 100, clientY: 100 })
    await tick()

    expect(firstNode.classList.contains('is-dragging')).toBe(true)

    await fireEvent.mouseMove(window, { clientX: 150, clientY: 130 })
    await tick()

    await fireEvent.mouseUp(window)
    await tick()

    expect(firstNode.classList.contains('is-dragging')).toBe(false)
  })

  it('opens side panel inspector with REST tabs when clicking a node', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = createDefaultFlowGraph()
    const onOpenInEditor = vi.fn()

    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: '',
        onOpenInEditor
      }
    })

    const firstNode = target.querySelector('.flow-node-rest .node-body') as HTMLElement
    expect(firstNode).toBeTruthy()

    await fireEvent.click(firstNode)
    await tick()

    // Side panel inspector should now be visible
    const sidePanel = target.querySelector('.flow-side-panel')
    expect(sidePanel).toBeTruthy()

    // Tabs should be present
    expect(getByText(sidePanel as HTMLElement, 'Params')).toBeTruthy()
    expect(getByText(sidePanel as HTMLElement, 'Headers')).toBeTruthy()
    expect(getByText(sidePanel as HTMLElement, 'Body')).toBeTruthy()
    expect(getByText(sidePanel as HTMLElement, 'Auth')).toBeTruthy()
    expect(getByText(sidePanel as HTMLElement, 'Captures')).toBeTruthy()
    expect(getByText(sidePanel as HTMLElement, 'Env')).toBeTruthy()
    expect(getByText(sidePanel as HTMLElement, 'History')).toBeTruthy()

    // Title in side panel should be editable
    const titleInput = sidePanel?.querySelector('.side-title-input') as HTMLInputElement
    expect(titleInput).toBeTruthy()
    expect(titleInput.value).toBe('1. Fetch Character')
    await fireEvent.input(titleInput, { target: { value: 'My New Block Name' } })
    expect(titleInput.value).toBe('My New Block Name')
  })

  it('triggers onOpenInEditor with block name in level 2 tab title', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = createDefaultFlowGraph()
    // Give the first REST node a response
    const restNode = graph.nodes.find((n) => n.type === 'rest')!
    restNode.lastRun = {
      durationMs: 120,
      status: 200,
      timestamp: Date.now(),
      responseText: '{"results": [{"id": 1}]}'
    }

    const onOpenInEditor = vi.fn()

    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: '',
        onOpenInEditor
      }
    })

    const editorQuickBtn = target.querySelector('.node-quick-btn') as HTMLButtonElement
    expect(editorQuickBtn).toBeTruthy()
    expect(editorQuickBtn.textContent?.trim()).toBe('↗ Editor')

    await fireEvent.click(editorQuickBtn)
    expect(onOpenInEditor).toHaveBeenCalledWith(
      '1. Fetch Character (200)',
      '{"results": [{"id": 1}]}'
    )
  })

  it('adds a new Event node when clicking ＋ Event', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = { nodes: [], connections: [] }
    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    const addEventBtn = getByText(target, '＋ Event')
    await fireEvent.click(addEventBtn)
    await tick()

    expect(target.querySelectorAll('.flow-node').length).toBe(1)
    expect(target.querySelector('.flow-node-circle')).toBeTruthy()

    // Floating type switcher should open automatically on new event creation
    expect(target.querySelector('.circle-type-control')).toBeTruthy()
  })

  it('shows floating type switcher on circle node via circular arrow button and switches between types', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = createDefaultFlowGraph()
    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    // Find the circular Start node
    const circleNode = target.querySelector('.flow-node-circle') as HTMLElement
    expect(circleNode).toBeTruthy()

    // Click it to select
    await fireEvent.click(circleNode)
    await tick()

    // Switch button should be present on selected node, but switcher popup is not yet open
    const switchBtn = circleNode.querySelector('.circle-switch-btn') as HTMLElement
    expect(switchBtn).toBeTruthy()
    expect(target.querySelector('.circle-type-control')).toBeNull()

    // Clicking the circular arrow switch button opens the floating switcher
    await fireEvent.click(switchBtn)
    await tick()

    const switcher = target.querySelector('.circle-type-control') as HTMLElement
    expect(switcher).toBeTruthy()
    expect(getByText(switcher, 'Start')).toBeTruthy()
    expect(getByText(switcher, 'Terminate')).toBeTruthy()
    expect(getByText(switcher, 'Jump')).toBeTruthy()
    expect(getByText(switcher, 'Receiver')).toBeTruthy()

    // Click 'Terminate' to switch type
    const termBtn = getByText(switcher, 'Terminate')
    await fireEvent.click(termBtn)
    await tick()

    expect(circleNode.classList.contains('flow-node-terminate')).toBe(true)
    // Switcher closes after selection
    expect(target.querySelector('.circle-type-control')).toBeNull()
  })

  it('displays connection line selector pill when clicking a connection wire and allows switching kind', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = createDefaultFlowGraph()
    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    const connGroup = target.querySelector('.connection-group') as HTMLElement
    expect(connGroup).toBeTruthy()

    await fireEvent.click(connGroup)
    await tick()

    const connBallWrap = target.querySelector('.conn-ball-overlay-wrap') as HTMLElement
    expect(connBallWrap).toBeTruthy()

    const connControl = connBallWrap.querySelector('.conn-ball-control') as HTMLElement
    expect(connControl).toBeTruthy()
    expect(getByText(connControl, 'Blue')).toBeTruthy()
    expect(getByText(connControl, 'Purple')).toBeTruthy()

    // Toggle to dotted / purple
    const purpleBtn = getByText(connControl, 'Purple')
    await fireEvent.click(purpleBtn)
    await tick()

    expect(connControl.classList.contains('is-dotted')).toBe(true)
  })

  it('toggles the File actions dropdown menu and displays menu items', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = createDefaultFlowGraph()
    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    const fileMenuBtn = target.querySelector('.flow-file-menu button') as HTMLButtonElement
    expect(fileMenuBtn).toBeTruthy()
    expect(target.querySelector('.flow-menu')).toBeNull()

    // Click to open
    await fireEvent.click(fileMenuBtn)
    await tick()

    const menu = target.querySelector('.flow-menu') as HTMLElement
    expect(menu).toBeTruthy()
    expect(getByText(menu, '📂 Open…')).toBeTruthy()
    expect(getByText(menu, '💾 Save')).toBeTruthy()
    expect(getByText(menu, '📝 Save As…')).toBeTruthy()
    expect(getByText(menu, '📥 Import blocks…')).toBeTruthy()
    expect(getByText(menu, '📤 Export (download)')).toBeTruthy()

    // Click again to close
    await fireEvent.click(fileMenuBtn)
    await tick()

    expect(target.querySelector('.flow-menu')).toBeNull()
  })

  it('adds a new Router node with multi-port output rack and default rules when clicking ＋ Flow Control', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = { nodes: [], connections: [] }
    const onSaveGraph = vi.fn()

    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: '',
        onSaveGraph
      }
    })

    const addRouterBtn = getByText(target, '＋ Flow Control')
    expect(addRouterBtn).toBeTruthy()
    await fireEvent.click(addRouterBtn)
    await tick()

    expect(target.querySelectorAll('.flow-node').length).toBe(1)
    const routerNode = target.querySelector('.flow-node-router') as HTMLElement
    expect(routerNode).toBeTruthy()

    // Multi-port output rack rendered on card
    const rack = routerNode.querySelector('.node-ports-rack')
    expect(rack).toBeTruthy()
    // Default 4 ports: Top, Mid, Bot (2)
    expect(rack?.querySelectorAll('.port-multi').length).toBe(4)
    expect(rack?.querySelector('.slot-top')).toBeTruthy()
    expect(rack?.querySelector('.slot-middle')).toBeTruthy()
    expect(rack?.querySelector('.slot-bottom')).toBeTruthy()

    // Inspector side panel opened for router
    expect(getByText(target, 'Routing Rules')).toBeTruthy()
    expect(target.querySelector('.tab-pane-router-rules')).toBeTruthy()
    expect(getByText(target, 'First Match (Stop at 1st match - Switch)')).toBeTruthy()
  })

  it('manages up to 10 ports across Top, Middle, Bottom slots on router node', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = { nodes: [], connections: [] }
    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    // Add router node via Flow Control
    await fireEvent.click(getByText(target, '＋ Flow Control'))
    await tick()

    // Switch to Ports tab in side panel
    const portsTabBtn = target.querySelector('.side-tab-btn:nth-child(2)') as HTMLButtonElement
    expect(portsTabBtn.textContent).toContain('Output Ports')
    await fireEvent.click(portsTabBtn)
    await tick()

    const portsPane = target.querySelector('.tab-pane-ports')
    expect(portsPane).toBeTruthy()
    expect(getByText(target, 'TOP Slot (Max 3)')).toBeTruthy()
    expect(getByText(target, 'MIDDLE Slot (Max 4)')).toBeTruthy()
    expect(getByText(target, 'BOTTOM Slot (Max 3)')).toBeTruthy()

    // Add another port to top slot (currently 1, max 3)
    const addTopBtn = getByText(target, '＋ Add Top Port') as HTMLButtonElement
    await fireEvent.click(addTopBtn)
    await tick()

    const topSection = target.querySelector('.slot-section-top')
    expect(topSection?.querySelectorAll('.port-item-card').length).toBe(2)

    // Add until top slot reaches 3
    await fireEvent.click(addTopBtn)
    await tick()
    expect(topSection?.querySelectorAll('.port-item-card').length).toBe(3)
    expect(addTopBtn.disabled).toBe(true)

    // Add 3 more middle ports so MIDDLE has all 4 ports configured
    const addMidBtn = getByText(target, '＋ Add Middle Port') as HTMLButtonElement
    await fireEvent.click(addMidBtn)
    await tick()
    await fireEvent.click(addMidBtn)
    await tick()
    await fireEvent.click(addMidBtn)
    await tick()
    expect(addMidBtn.disabled).toBe(true)

    // Assert all 4 middle ports are rendered on the canvas card rack with unique top positions
    const routerNode = target.querySelector('.flow-node-router') as HTMLElement
    const midPortEls = routerNode.querySelectorAll('.node-ports-rack .slot-middle') as NodeListOf<HTMLElement>
    expect(midPortEls.length).toBe(4)

    const topPositions = Array.from(midPortEls).map((el) => el.style.top)
    const uniqueTops = new Set(topPositions)
    expect(uniqueTops.size).toBe(4) // All 4 have distinct, non-overlapping positions!
  })

  it('supports configuring dynamic multi-ports on JS block', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = { nodes: [], connections: [] }
    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    // Add JS node via Logic & Code
    await fireEvent.click(getByText(target, '＋ Logic & Code'))
    await tick()

  const jsNode = target.querySelector('.flow-node-js') as HTMLElement
  expect(jsNode).toBeTruthy()
  // Initially single port output
  expect(jsNode.querySelector('.node-ports-rack')).toBeNull()
  expect(jsNode.querySelector('.port-output')).toBeTruthy()

  // Open Ports tab on JS Inspector
  const jsPortsTabBtn = target.querySelector('.side-tab-btn:nth-child(2)') as HTMLButtonElement
  expect(jsPortsTabBtn.textContent).toContain('Ports (0/10)')
  await fireEvent.click(jsPortsTabBtn)
  await tick()

  expect(getByText(target, 'JS Dynamic Output Ports')).toBeTruthy()
  const addTopBtn = getByText(target, '＋ Add Top Port')
  await fireEvent.click(addTopBtn)
  await tick()

  expect(jsNode.querySelector('.node-ports-rack')).toBeTruthy()
  expect(jsNode.querySelectorAll('.port-multi').length).toBe(1)
})

  it('supports switching block type on cards via (↻) card switcher button', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = { nodes: [], connections: [] }
    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    // Add JS block via Logic & Code
    await fireEvent.click(getByText(target, '＋ Logic & Code'))
    await tick()

    const jsNode = target.querySelector('.flow-node-js') as HTMLElement
    expect(jsNode).toBeTruthy()

    // Find and click the (↻) switch button
    const switchBtn = jsNode.querySelector('.card-switch-btn') as HTMLButtonElement
    expect(switchBtn).toBeTruthy()
    await fireEvent.click(switchBtn)
    await tick()

    // Switcher popup should be visible with Logic & Code options
    const switcher = target.querySelector('.node-type-switcher') as HTMLElement
    expect(switcher).toBeTruthy()
    expect(switcher.textContent).toContain('JS Script')
    expect(switcher.textContent).toContain('JSON Mapper')

    // Click JSON Mapper
    const mapperBtn = switcher.querySelectorAll('.variant-btn')[1] as HTMLButtonElement
    expect(mapperBtn.textContent).toContain('JSON Mapper')
    await fireEvent.click(mapperBtn)
    await tick()

    // Node is now transform / JSON Mapper
    expect(target.querySelector('.flow-node-js')).toBeNull()
    const transformNode = target.querySelector('.flow-node-transform') as HTMLElement
    expect(transformNode).toBeTruthy()
    expect(target.querySelector('.node-type-switcher')).toBeNull()
    expect(transformNode.querySelector('.node-transform-preview-compact')).toBeTruthy()
  })

  it('supports Flow Control type switching between Router, Loop, Delay and Merge', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = { nodes: [], connections: [] }
    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    // Add Router block via Flow Control
    await fireEvent.click(getByText(target, '＋ Flow Control'))
    await tick()

    const routerNode = target.querySelector('.flow-node-router') as HTMLElement
    expect(routerNode).toBeTruthy()

    // Open card switcher
    const switchBtn = routerNode.querySelector('.card-switch-btn') as HTMLButtonElement
    await fireEvent.click(switchBtn)
    await tick()

    const switcher = target.querySelector('.node-type-switcher') as HTMLElement
    expect(switcher).toBeTruthy()
    expect(switcher.textContent).toContain('Router')
    expect(switcher.textContent).toContain('Loop')
    expect(switcher.textContent).toContain('Delay')
    expect(switcher.textContent).toContain('Merge')

    // Select Merge
    const mergeBtn = Array.from(switcher.querySelectorAll('.variant-btn')).find((b) =>
      b.textContent?.includes('Merge')
    ) as HTMLButtonElement
    expect(mergeBtn).toBeTruthy()
    await fireEvent.click(mergeBtn)
    await tick()

    // Node is now merge
    const mergeNode = target.querySelector('.flow-node-merge') as HTMLElement
    expect(mergeNode).toBeTruthy()

    // Merge multi-inputs rack rendered on left edge
    const inputsRack = mergeNode.querySelector('.node-inputs-rack') as HTMLElement
    expect(inputsRack).toBeTruthy()
    expect(inputsRack.querySelectorAll('.port-multi-input').length).toBe(2)
  })

  it('renders slim compact preview bodies across all block types', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph = { nodes: [], connections: [] }
    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    // Add Router block via Flow Control
    await fireEvent.click(getByText(target, '＋ Flow Control'))
    await tick()

    const routerNode = target.querySelector('.flow-node-router') as HTMLElement
    expect(routerNode.querySelector('.node-router-preview-compact')).toBeTruthy()
    expect(routerNode.querySelector('.node-compact-summary')).toBeTruthy()

    // Add Logic & Code block and switch to Mapper
    await fireEvent.click(getByText(target, '＋ Logic & Code'))
    await tick()

    const jsNode = target.querySelector('.flow-node-js') as HTMLElement
    const switchBtn = jsNode.querySelector('.card-switch-btn') as HTMLButtonElement
    await fireEvent.click(switchBtn)
    await tick()

    const switcher = target.querySelector('.node-type-switcher') as HTMLElement
    const mapperBtn = switcher.querySelectorAll('.variant-btn')[1] as HTMLButtonElement
    await fireEvent.click(mapperBtn)
    await tick()

    const mapperNode = target.querySelector('.flow-node-transform') as HTMLElement
    expect(mapperNode.querySelector('.node-transform-preview-compact')).toBeTruthy()
    expect(mapperNode.querySelector('.node-compact-summary')).toBeTruthy()
  })

  it('executes JSON Mapper and generates formatted output with open in editor button', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph: FlowGraph = {
      nodes: [
        {
          id: 'map_1',
          type: 'transform' as const,
          title: 'User Mapper',
          x: 100,
          y: 100,
          status: 'idle' as const,
          transformData: {
            sampleInput: JSON.stringify({ user_id: 104, raw_name: ' rick sanchez ' }),
            mappings: [
              { id: 'm1', sourcePath: 'user_id', targetPath: 'id', modifier: 'number' as const },
              { id: 'm2', sourcePath: 'raw_name', targetPath: 'profile.name', modifier: 'trim' as const }
            ]
          }
        }
      ],
      connections: []
    }

    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: '',
        onOpenInEditor: () => {}
      }
    })

    const mapperNode = target.querySelector('.flow-node-transform') as HTMLElement
    expect(mapperNode).toBeTruthy()

    // Click Run block button [▶]
    const playBtn = mapperNode.querySelector('.node-tool-btn') as HTMLButtonElement
    expect(playBtn).toBeTruthy()
    await fireEvent.click(playBtn)
    await tick()

    // Node status should be success and lastRun recorded
    expect(graph.nodes[0].status).toBe('success')
    expect(graph.nodes[0].lastRun?.status).toBe(200)
    expect(graph.nodes[0].lastRun?.responseText).toContain('"id": 104')
    expect(graph.nodes[0].lastRun?.responseText).toContain('"name": "rick sanchez"')

    // Quick open in editor button should now appear in the footer
    const editorBtn = mapperNode.querySelector('.node-quick-btn') as HTMLButtonElement
    expect(editorBtn).toBeTruthy()
    expect(editorBtn.textContent).toContain('↗ Editor')
  })

  it('executes Loop block and iterates its body node N times saving logs and history', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph: FlowGraph = {
      nodes: [
        {
          id: 'loop_1',
          type: 'loop' as const,
          title: 'Counter Loop',
          x: 100,
          y: 100,
          status: 'idle' as const,
          loopData: {
            mode: 'count',
            repeatCount: 3,
            indexVar: 'i',
            itemVar: 'item',
            arrayPath: ''
          }
        },
        {
          id: 'js_body',
          type: 'js' as const,
          title: 'Body Worker',
          x: 350,
          y: 100,
          status: 'idle' as const,
          jsData: {
            code: 'console.log("Worker running for iteration " + pm.environment.get("i"))\npm.environment.set("last_i", pm.environment.get("i"))'
          }
        }
      ],
      connections: [
        {
          id: 'c1',
          fromId: 'loop_1',
          toId: 'js_body',
          fromPort: 'item',
          kind: 'solid'
        }
      ]
    }

    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    const loopEl = target.querySelector('.flow-node-loop') as HTMLElement
    expect(loopEl).toBeTruthy()

    // Click [▶] on the Loop block
    const loopPlayBtn = loopEl.querySelector('.node-tool-btn') as HTMLButtonElement
    expect(loopPlayBtn).toBeTruthy()
    await fireEvent.click(loopPlayBtn)

    // Wait for the iterations to execute
    await new Promise((r) => setTimeout(r, 100))
    await tick()

    // Loop node status should be success
    expect(graph.nodes[0].status).toBe('success')
    expect(graph.nodes[0].lastRun?.status).toBe('LOOP_DONE')
    expect(graph.nodes[0].lastRun?.outputSummary).toContain('Repeated 3 times')

    // Body node should be executed 3 times and save all iteration logs
    const bodyNode = graph.nodes[1]
    expect(bodyNode.status).toBe('success')
    expect(bodyNode.lastRun).toBeTruthy()
    expect(bodyNode.lastRun?.logs).toBeDefined()
    expect(bodyNode.lastRun?.logs?.length).toBe(3)
    expect(bodyNode.lastRun?.logs?.[0]).toContain('[Iter #1] Worker running for iteration 0')
    expect(bodyNode.lastRun?.logs?.[1]).toContain('[Iter #2] Worker running for iteration 1')
    expect(bodyNode.lastRun?.logs?.[2]).toContain('[Iter #3] Worker running for iteration 2')
    expect(bodyNode.history?.length).toBe(3)
  })

  it('runs full flow with Loop, body node and post-loop Done node without deadlock', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph: FlowGraph = {
      nodes: [
        {
          id: 'loop_1',
          type: 'loop' as const,
          title: 'Loop 2x',
          x: 100,
          y: 100,
          status: 'idle' as const,
          loopData: {
            mode: 'count',
            repeatCount: 2,
            indexVar: 'idx',
            itemVar: 'item',
            arrayPath: ''
          }
        },
        {
          id: 'js_body',
          type: 'js' as const,
          title: 'Body Worker',
          x: 350,
          y: 100,
          status: 'idle' as const,
          jsData: {
            code: 'console.log("Count " + pm.environment.get("idx"))'
          }
        },
        {
          id: 'js_done',
          type: 'js' as const,
          title: 'Done Handler',
          x: 600,
          y: 100,
          status: 'idle' as const,
          jsData: {
            code: 'console.log("Loop finished successfully")'
          }
        }
      ],
      connections: [
        {
          id: 'c_body',
          fromId: 'loop_1',
          toId: 'js_body',
          fromPort: 'item',
          kind: 'solid'
        },
        {
          id: 'c_loopback',
          fromId: 'js_body',
          toId: 'loop_1',
          toPort: 'in',
          kind: 'solid'
        },
        {
          id: 'c_done',
          fromId: 'loop_1',
          toId: 'js_done',
          fromPort: 'done',
          kind: 'solid'
        }
      ]
    }

    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    // Click "Run Flow" button in toolbar
    const runFlowBtn = getByText(target, 'Run Flow')
    expect(runFlowBtn).toBeTruthy()
    await fireEvent.click(runFlowBtn)

    // Wait for flow execution
    await new Promise((r) => setTimeout(r, 700))
    await tick()

    // Loop should complete
    expect(graph.nodes[0].status).toBe('success')
    // Body node should be executed 2 times with logs
    expect(graph.nodes[1].status).toBe('success')
    expect(graph.nodes[1].lastRun?.logs?.length).toBe(2)
    expect(graph.nodes[1].lastRun?.logs?.[0]).toContain('[Iter #1] Count 0')
    expect(graph.nodes[1].lastRun?.logs?.[1]).toContain('[Iter #2] Count 1')

    // Done node should be executed after loop finishes
    expect(graph.nodes[2].status).toBe('success')
    expect(graph.nodes[2].lastRun?.logs).toContain('Loop finished successfully')
  })

  it('runs flow with router branching into merge without deadlock, marking inactive branch as skipped', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph: FlowGraph = {
      nodes: [
        {
          id: 'js_init',
          type: 'js' as const,
          title: 'Init Data',
          x: 50,
          y: 100,
          status: 'idle' as const,
          jsData: {
            code: 'pm.environment.set("role", "admin")\nconsole.log("Initialized role")'
          }
        },
        {
          id: 'router_1',
          type: 'router' as const,
          title: 'Role Router',
          x: 250,
          y: 100,
          status: 'idle' as const,
          routerData: {
            mode: 'first-match',
            ports: [
              { id: 'port_admin', label: 'Admin Route', slot: 'middle' },
              { id: 'port_user', label: 'User Route', slot: 'bottom' }
            ],
            rules: [
              {
                id: 'rule_admin',
                label: 'Admin Check',
                portId: 'port_admin',
                type: 'jsonpath',
                path: 'role',
                operator: '==',
                value: 'admin'
              },
              {
                id: 'rule_user',
                label: 'User Check',
                portId: 'port_user',
                type: 'otherwise'
              }
            ]
          }
        },
        {
          id: 'js_admin_branch',
          type: 'js' as const,
          title: 'Admin Branch',
          x: 450,
          y: 50,
          status: 'idle' as const,
          jsData: {
            code: 'console.log("Admin branch executed")'
          }
        },
        {
          id: 'js_user_branch',
          type: 'js' as const,
          title: 'User Branch',
          x: 450,
          y: 200,
          status: 'idle' as const,
          jsData: {
            code: 'console.log("User branch executed")'
          }
        },
        {
          id: 'merge_1',
          type: 'merge' as const,
          title: 'Join Branches',
          x: 650,
          y: 100,
          status: 'idle' as const,
          mergeData: {
            strategy: 'wait-all'
          }
        },
        {
          id: 'js_final',
          type: 'js' as const,
          title: 'Final Step',
          x: 850,
          y: 100,
          status: 'idle' as const,
          jsData: {
            code: 'console.log("Final step reached successfully")'
          }
        }
      ],
      connections: [
        { id: 'c1', fromId: 'js_init', toId: 'router_1', kind: 'solid' },
        { id: 'c2', fromId: 'router_1', toId: 'js_admin_branch', fromPort: 'port_admin', kind: 'solid' },
        { id: 'c3', fromId: 'router_1', toId: 'js_user_branch', fromPort: 'port_user', kind: 'solid' },
        { id: 'c4', fromId: 'js_admin_branch', toId: 'merge_1', toPort: 'in_admin', kind: 'solid' },
        { id: 'c5', fromId: 'js_user_branch', toId: 'merge_1', toPort: 'in_user', kind: 'solid' },
        { id: 'c6', fromId: 'merge_1', toId: 'js_final', fromPort: 'joined', kind: 'solid' }
      ]
    }

    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    const runFlowBtn = getByText(target, 'Run Flow')
    await fireEvent.click(runFlowBtn)

    await new Promise((r) => setTimeout(r, 1300))
    await tick()

    // Init & Router should succeed
    expect(graph.nodes[0].status).toBe('success')
    expect(graph.nodes[1].status).toBe('success')
    // Admin branch should succeed
    expect(graph.nodes[2].status).toBe('success')
    expect(graph.nodes[2].lastRun?.logs).toContain('Admin branch executed')
    // User branch should be marked as skipped!
    expect(graph.nodes[3].status).toBe('skipped')
    // Merge node should NOT deadlock: it must succeed!
    expect(graph.nodes[4].status).toBe('success')
    expect(graph.nodes[4].lastRun?.status).toBe('MERGED')
    // Final step node after merge must also execute!
    expect(graph.nodes[5].status).toBe('success')
    expect(graph.nodes[5].lastRun?.logs).toContain('Final step reached successfully')
  })

  it('passes upstream payload directly into downstream JS block sandbox options', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph: FlowGraph = {
      nodes: [
        {
          id: 'js_producer',
          type: 'js' as const,
          title: 'Payload Producer',
          x: 100,
          y: 100,
          status: 'idle' as const,
          jsData: {
            code: 'pm.environment.set("msg", "hello_world")\nconsole.log("produced")'
          }
        },
        {
          id: 'js_consumer',
          type: 'js' as const,
          title: 'Payload Consumer',
          x: 350,
          y: 100,
          status: 'idle' as const,
          jsData: {
            code: 'console.log("Received payload: " + (payload ? payload.msg : "null"))'
          }
        }
      ],
      connections: [
        { id: 'c_pipe', fromId: 'js_producer', toId: 'js_consumer', kind: 'solid' }
      ]
    }

    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    const runFlowBtn = getByText(target, 'Run Flow')
    await fireEvent.click(runFlowBtn)

    await new Promise((r) => setTimeout(r, 500))
    await tick()

    expect(graph.nodes[0].status).toBe('success')
    expect(graph.nodes[1].status).toBe('success')
    // Consumer received the upstream payload object directly in `payload`
    expect(graph.nodes[1].lastRun?.logs).toContain('Received payload: hello_world')
  })

  it('saves transform mapped output to currentEnv even when activeEnvName is empty', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const graph: FlowGraph = {
      nodes: [
        {
          id: 'tr_1',
          type: 'transform' as const,
          title: 'Mapper',
          x: 100,
          y: 100,
          status: 'idle' as const,
          transformData: {
            sampleInput: JSON.stringify({ user: { firstName: 'Alice' } }),
            mappings: [
              { id: 'm1', sourcePath: 'user.firstName', targetPath: 'name' }
            ],
            saveToEnvVar: 'mappedName'
          }
        },
        {
          id: 'js_reader',
          type: 'js' as const,
          title: 'Env Reader',
          x: 350,
          y: 100,
          status: 'idle' as const,
          jsData: {
            code: 'console.log("Read env: " + pm.environment.get("mappedName"))'
          }
        }
      ],
      connections: [
        { id: 'c_tr', fromId: 'tr_1', toId: 'js_reader', kind: 'solid' }
      ]
    }

    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        environments: {},
        activeEnvName: '', // Notice: empty activeEnvName!
        globalProxy: ''
      }
    })

    const runFlowBtn = getByText(target, 'Run Flow')
    await fireEvent.click(runFlowBtn)

    await new Promise((r) => setTimeout(r, 500))
    await tick()

    expect(graph.nodes[0].status).toBe('success')
    expect(graph.nodes[1].status).toBe('success')
    // Downstream JS successfully reads the variable saved by transform
    expect(graph.nodes[1].lastRun?.logs?.[0]).toContain('Read env:')
    expect(graph.nodes[1].lastRun?.logs?.[0]).toContain('Alice')
  })

  it('runs sub-flow in event-throw and passes payload to event-catch', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const subGraph: FlowGraph = {
      nodes: [
        {
          id: 'sub_js_1',
          type: 'js' as const,
          title: 'Subflow Worker',
          x: 50,
          y: 50,
          status: 'idle' as const,
          jsData: {
            code: 'console.log("Worker inside subflow executed")'
          }
        }
      ],
      connections: []
    }

    const graph: FlowGraph = {
      nodes: [
        {
          id: 'throw_sub',
          type: 'event-throw' as const,
          title: 'Throw Subflow',
          x: 100,
          y: 100,
          status: 'idle' as const,
          eventData: {
            eventName: 'order-processed',
            targetFlowId: 'flow-sub-1',
            targetFlowName: 'Order Subflow'
          }
        },
        {
          id: 'catch_ev',
          type: 'event-catch' as const,
          title: 'Catch Event',
          x: 350,
          y: 100,
          status: 'idle' as const,
          eventData: {
            eventName: 'order-processed'
          }
        }
      ],
      connections: [
        { id: 'c_ev', fromId: 'throw_sub', toId: 'catch_ev', kind: 'solid' }
      ]
    }

    mount(FlowCanvas, {
      target,
      props: {
        flowGraph: graph,
        availableFlows: [
          {
            id: 'flow-sub-1',
            name: 'Order Subflow',
            groupName: 'Subflows',
            graph: subGraph
          }
        ],
        environments: {},
        activeEnvName: '',
        globalProxy: ''
      }
    })

    const runFlowBtn = getByText(target, 'Run Flow')
    await fireEvent.click(runFlowBtn)

    await new Promise((r) => setTimeout(r, 600))
    await tick()

    // Event-throw should have executed the sub-flow and captured logs!
    expect(graph.nodes[0].status).toBe('success')
    expect(graph.nodes[0].lastRun?.status).toBe('SUBFLOW_OK')
    expect(graph.nodes[0].lastRun?.logs).toContain('Worker inside subflow executed')

    // Event-catch should have triggered
    expect(graph.nodes[1].status).toBe('success')
    expect(graph.nodes[1].lastRun?.status).toBe('EVENT_CAUGHT')
  })
})


