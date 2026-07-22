package org.lean.rest.servlet;

import org.lean.rest.LeanRest;

import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.ServletContextListener;
import jakarta.servlet.annotation.WebListener;

@WebListener
public class LeanServletContextListener implements ServletContextListener {

    @Override
    public void contextInitialized(ServletContextEvent event){
        LeanRest leanRest = LeanRest.getInstance();
    }

}
