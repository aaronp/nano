import DefaultTheme from 'vitepress/theme'
import OpenInNano from './OpenInNano.vue'
import './custom.css'

export default { extends: DefaultTheme, enhanceApp: ({ app }) => app.component('OpenInNano', OpenInNano) }
