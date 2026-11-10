package co.edu.ucc.acordia;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Punto de entrada de Acordia.
 *
 * Al ejecutar esta clase se levanta un servidor web en http://localhost:8080
 * que sirve la página (carpeta resources/static) y la API REST (/api/...).
 */
@SpringBootApplication
public class AcordiaApplication {

    public static void main(String[] args) {
        SpringApplication.run(AcordiaApplication.class, args);
    }
}
