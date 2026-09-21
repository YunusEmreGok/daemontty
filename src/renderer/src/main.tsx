import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import '@fontsource/fira-code/400.css'
import '@fontsource/fira-code/700.css'
import './styles.css'
import App from './App'
import { UiProvider } from './components/Ui'

createRoot(document.getElementById('root')!).render(
  <UiProvider>
    <App />
  </UiProvider>
)
