import multiprocessing, sys
from nexspiro.ui.main_window import main

if __name__ == "__main__":
    multiprocessing.freeze_support()
    sys.exit(main())
