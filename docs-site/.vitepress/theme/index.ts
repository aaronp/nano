import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import OpenInNano from './OpenInNano.vue'
import './custom.css'

export default { extends: DefaultTheme, Layout, enhanceApp: ({ app }) => app.component('OpenInNano', OpenInNano) }
