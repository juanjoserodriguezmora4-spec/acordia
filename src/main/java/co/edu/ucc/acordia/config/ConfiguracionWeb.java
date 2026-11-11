package co.edu.ucc.acordia.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * La página (HTML, CSS y JavaScript) se sirve con "no-cache": el navegador puede guardarla, pero antes de usarla
 * pregunta al servidor si cambió. Si no cambió, el servidor responde "sin cambios" (304) y no se vuelve a descargar.
 *
 * Sin esto, al copiar una versión nueva de app.js el navegador podía seguir usando la vieja aunque se recargara
 * la página, y parecía que la actualización no había funcionado.
 */
@Configuration
public class ConfiguracionWeb implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/")
                .setCacheControl(CacheControl.noCache());
    }
}
