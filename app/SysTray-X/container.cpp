#include "container.h"

/*
 *	Local includes
 */
#include "preferences.h"

/*
 *	System includes
 */

/*
 *  Qt includes
 */
#include <QIcon>
#include <QCloseEvent>
#include <QVBoxLayout>

/*
 *  Constructor
 */
Container::Container( Preferences* pref, QWidget *parent ) : QWidget( parent )
{
    /*
     *  Store the preferences
     */
    m_pref = pref;

    /*
     *  Construct conatainer
     */
    QVBoxLayout* layout = new QVBoxLayout( this );
    setLayout( layout );

    /*
     *  Set properties
     */
    setWindowIcon( QIcon( ":/files/icons/Thunderbird.png" ) );
    setWindowTitle( "Mozilla Thunderbird" );
}


/*
 *  Set the TB widget
 */
void    Container::setWidget( QWidget* widget )
{
    layout()->addWidget( widget );
}


/*
 *  Remove the TB widget
 */
void    Container::removeWidget( QWidget* widget )
{
    layout()->removeWidget( widget );
}


/*
 *  Override the close event handler
 */
void    Container::closeEvent( QCloseEvent *event )
{
    if( m_minimize_close )
    {
        /*
         *  Minimize instead of close
         */
        event->ignore();

        emit signalShowHide();
    }
    else
    {
        /*
         *  Close
         */
        event->accept();
    }
}

#ifdef FF_NEET

/*
 *  Override the minimize event
 */
void    Container::changeEvent( QEvent * event )
{
    switch( event->type() )
    {
        case QEvent::WindowStateChange:
        {
            if( isMinimized() )
            {
                setWindowState(reinterpret_cast<QWindowStateChangeEvent *>(event)->oldState());
                event->accept();
            }

            break;
        }

        default:
        {
             QWidget::changeEvent( event );
        }
    }
}

#endif


/**
 * @brief slotMinimizeOnClose. Hnadle preference minimize on close signal.
 */
void    Container::slotMinimizeOnClose()
{
    m_minimize_close = m_pref->getMinimizeOnClose();
}