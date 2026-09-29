// A source-reviewed map of this prototype. AI-generated repository maps will use
// the same data contract; they will not supply HTML or executable components.
export const components = [
  {id:'terminal',name:'Terminal interface',kind:'ENTRY POINT',icon:'terminal',accent:'mint',path:'src/tui.mjs',summary:'The front door to your research.',role:'Draws the Medusae home screen, handles keyboard navigation, and opens or resumes local chat sessions. It also launches the visual explorer.',tags:['Keyboard navigation','Local sessions'],position:{x:40,y:0}},
  {id:'sessions',name:'Session memory',kind:'PERSISTENCE',icon:'database',accent:'violet',path:'src/sessions.mjs',summary:'Pick up where you left off.',role:'Stores repository URLs and your questions in a local JSON file. Writes are atomic, and sessions survive restarting the terminal. There are no generated assistant replies yet.',tags:['Local JSON','Atomic writes'],position:{x:770,y:0}},
  {id:'preview',name:'Preview server',kind:'LOCAL SERVICE',icon:'server',accent:'amber',path:'src/preview.mjs',summary:'Your map, served on localhost.',role:'Starts Next.js on an available loopback port and provides a clean shutdown hook to the terminal. The visual app runs locally.',tags:['Next.js','Loopback only'],position:{x:0,y:280}},
  {id:'explorer',name:'Visual explorer',kind:'INTERFACE',icon:'network',accent:'cyan',path:'components/explorer.jsx',summary:'See the system before the source.',role:'Renders component cards and their connections with React Flow. Cards reveal general roles first; a separate action loads the complete source file into a reader.',tags:['React Flow','Progressive detail'],position:{x:810,y:280}},
  {id:'source',name:'Source reader',kind:'EVIDENCE',icon:'code',accent:'rose',path:'app/api/source/route.js',summary:'Every thread leads back to code.',role:'Reads only the source files included in this component catalog and returns their full contents with line numbers. Arbitrary paths and secret files are not exposed.',tags:['Read only','Allowed files'],position:{x:40,y:560}},
  {id:'catalog',name:'Component catalog',kind:'STRUCTURE',icon:'layers',accent:'blue',path:'lib/catalog.mjs',summary:'One language for every map.',role:'Defines the components, roles, source paths, and relationships used by this design preview. Future model output will be validated into this structure before rendering.',tags:['Structured data','Consistent visuals'],position:{x:770,y:560}}
];

// Reports select one bounded visual profile. The model may propose a profile from
// this list, but it never controls HTML, CSS, or arbitrary colour values.
export const visualProfiles = [
  {id:'signal',label:'Signal',description:'Dark technical canvas with a luminous green core.'},
  {id:'violet',label:'Violet',description:'Deep indigo canvas for product and application maps.'},
  {id:'ember',label:'Ember',description:'Warm graphite canvas for pipelines and data movement.'}
];

export const workflow = [
  {source:'terminal',target:'preview',label:'launches'},
  {source:'preview',target:'explorer',label:'serves'},
  {source:'explorer',target:'source',label:'requests code'},
  {source:'source',target:'catalog',label:'checks allowed paths'},
  {source:'terminal',target:'sessions',label:'saves questions'}
];
